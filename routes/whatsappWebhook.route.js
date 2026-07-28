const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { waMessageRepo } = require("../repositories");
const { QUEUES, enqueue } = require("../config/queue");
const { toE164 } = require("../utils/phone");

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

    for (const change of changes) {
      const value = change.value || {};

      for (const message of value.messages || []) {
        try {
          const waPhone = toE164(`+${message.from}`) || `+${message.from}`;
          const row = await waMessageRepo.recordInbound({
            wamid: message.id,
            waPhone,
            payload: message,
          });
          if (!row) continue; // Meta retry — already recorded, already queued
          await enqueue(QUEUES.WA_INBOUND, { waMessageId: row.id });
        } catch (err) {
          // The message row (if written) is the janitor's re-entry point; the
          // error is logged, and Meta gets its 200 — retrying the whole batch
          // would only duplicate the parts that DID succeed.
          console.error("[wa-webhook] inbound handling failed:", err.message);
        }
      }

      for (const status of value.statuses || []) {
        try {
          const detail = status.errors?.[0]?.message || status.errors?.[0]?.title || "";
          await waMessageRepo.applyStatusUpdate(status.id, status.status, detail);
        } catch (err) {
          console.error("[wa-webhook] status handling failed:", err.message);
        }
      }
    }

    return res.sendStatus(200);
  }
);

function verifyMetaSignature(req, res, buf) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    console.error("WHATSAPP_APP_SECRET not set – rejecting webhook");
    throw new Error("Webhook signing key not configured");
  }

  const header = req.headers["x-hub-signature-256"] || "";
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(buf).digest("hex")}`;

  // timingSafeEqual demands equal lengths; a wrong-length header is simply wrong.
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Invalid WhatsApp signature");
  }
}

module.exports = router;
