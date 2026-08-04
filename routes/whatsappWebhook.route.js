const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { waMessageRepo } = require("../repositories");
const { QUEUES, enqueue } = require("../config/queue");
const { toE164 } = require("../utils/phone");

// Meta retries undelivered webhooks for up to 7 days, so after an outage it
// redelivers the whole backlog at once. Acted on, a burst of hours-old messages
// (each "hi" is a menu command) hijacks whatever live conversation is happening
// now. This is how long Meta may have held a message before we still act on it;
// past it, we record for audit but do not process. Measured at the webhook, so
// "now" is receipt time — our own queue backlog can never trip it, only a real
// Meta-side delay (an outage/retry) can.
const STALE_INBOUND_SECONDS = Number(process.env.WA_STALE_INBOUND_SECONDS) || 300;

/**
 * Seconds Meta held this message between the customer sending it
 * (message.timestamp, unix seconds) and this webhook receiving it. 0 when the
 * timestamp is missing or unparseable — an absent clock must never be read as
 * "very old" and silently drop a fresh message.
 */
const heldSeconds = (metaTimestamp) => {
  const sentMs = Number(metaTimestamp) * 1000;
  if (!Number.isFinite(sentMs) || sentMs <= 0) return 0;
  return Math.max(0, Math.round((Date.now() - sentMs) / 1000));
};

/**
 * The Meta webhook. Same mounting pattern as the Paystack webhook: raw body
 * before global express.json(), HMAC verified over the exact bytes Meta
 * signed. The POST does the minimum a durable inbox needs — record exactly
 * once (wamid dedupe), enqueue, 200 — because Meta retries unacknowledged
 * deliveries for up to 7 days and a payload we fail to persist is
 * unrecoverable.
 */

// GET /api/whatsapp/webhook — Meta's one-time subscription handshake.
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// POST /api/whatsapp/webhook — messages and delivery statuses.
router.post(
  "/",
  express.raw({ type: "application/json", verify: verifyMetaSignature }),
  async (req, res) => {
    let body;
    try {
      body = JSON.parse(req.body);
    } catch (parseErr) {
      console.error("[wa-webhook] JSON parse error:", parseErr.message);
      return res.sendStatus(400);
    }

    // Meta batches; each change carries messages (inbound) and/or statuses
    // (receipts for our sends). Process every one individually — batching is
    // not guaranteed to be stable.
    const changes = (body.entry || []).flatMap((e) => e.changes || []);
    const msgCount = changes.reduce((n, c) => n + (c.value?.messages?.length || 0), 0);
    const statusCount = changes.reduce((n, c) => n + (c.value?.statuses?.length || 0), 0);
    // Reaching this line means the signature already passed — so its presence
    // (or absence) in the logs distinguishes an inbound/queue problem from a
    // signature rejection upstream.
    console.log(
      `[wa-webhook] accepted POST: ${changes.length} change(s), ${msgCount} message(s), ${statusCount} status(es)`
    );

    for (const change of changes) {
      const value = change.value || {};

      for (const message of value.messages || []) {
        const waPhone = toE164(`+${message.from}`) || `+${message.from}`;
        try {
          const row = await waMessageRepo.recordInbound({
            wamid: message.id,
            waPhone,
            payload: message,
          });
          if (!row) {
            // Meta retry — already recorded, already queued.
            console.log(`[wa-webhook] inbound ${message.id} from ${waPhone}: duplicate, already queued`);
            continue;
          }
          // Stale guard: a message Meta held far past when the customer sent it
          // is a post-outage redelivery, not something to act on now. Record it
          // for the audit trail, mark it skipped (so the stuck-inbound janitor,
          // which only re-enqueues 'received' rows, leaves it alone), and don't
          // queue it — otherwise a backlog of old greetings resets a live chat.
          const held = heldSeconds(message.timestamp);
          if (held > STALE_INBOUND_SECONDS) {
            await waMessageRepo.markSkipped(
              row.id,
              `stale inbound: Meta held ${held}s (> ${STALE_INBOUND_SECONDS}s), likely post-outage redelivery`
            );
            console.log(
              `[wa-webhook] inbound ${message.id} from ${waPhone}: SKIPPED stale (held ${held}s > ${STALE_INBOUND_SECONDS}s), not queued`
            );
            continue;
          }
          await enqueue(QUEUES.WA_INBOUND, { waMessageId: row.id });
          console.log(`[wa-webhook] inbound ${message.id} from ${waPhone}: recorded (row ${row.id}) + queued`);
        } catch (err) {
          // The message row (if written) is the janitor's re-entry point; the
          // error is logged, and Meta gets its 200 — retrying the whole batch
          // would only duplicate the parts that DID succeed. Drizzle buries
          // the Postgres reason in err.cause — print it, or the log shows a
          // query with no verdict.
          console.error(
            "[wa-webhook] inbound handling failed:",
            err.cause?.message || err.message
          );
        }
      }

      for (const status of value.statuses || []) {
        try {
          const detail = status.errors?.[0]?.message || status.errors?.[0]?.title || "";
          console.log(
            `[wa-webhook] status ${status.id}: ${status.status}${detail ? ` — ${detail}` : ""}`
          );
          await waMessageRepo.applyStatusUpdate(status.id, status.status, detail);
        } catch (err) {
          console.error(
            "[wa-webhook] status handling failed:",
            err.cause?.message || err.message
          );
        }
      }
    }

    return res.sendStatus(200);
  }
);

function verifyMetaSignature(req, res, buf) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    console.error("[wa-webhook] WHATSAPP_APP_SECRET not set – rejecting webhook");
    throw new Error("Webhook signing key not configured");
  }

  const header = req.headers["x-hub-signature-256"] || "";
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(buf).digest("hex")}`;

  // timingSafeEqual demands equal lengths; a wrong-length header is simply wrong.
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    // Diagnostics WITHOUT leaking the secret or the payload. This reads the
    // three distinct failure modes apart:
    //   bodyBytes === 0        → the raw body never reached us (a body parser
    //                            ran before this route; the HMAC is over empty)
    //   hasSignatureHeader:false → Meta isn't signing / wrong URL subscribed
    //   lengths equal, still no match → the App Secret here != Meta's App Secret
    console.warn(
      "[wa-webhook] SIGNATURE REJECTED " +
        JSON.stringify({
          hasSignatureHeader: header.length > 0,
          headerLen: a.length,
          expectedLen: b.length,
          bodyBytes: buf ? buf.length : 0,
          appSecretConfigured: true,
        })
    );
    throw new Error("Invalid WhatsApp signature");
  }
}

module.exports = router;
