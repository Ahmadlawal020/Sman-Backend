const axios = require("axios");
const { REPLY } = require("./constants");

/**
 * The thin Cloud API sender. One job: faithfully transmit a reply the engine
 * already decided on — all conversation logic and every WhatsApp limit lives
 * in the engine, so this file never edits content, only maps reply data to
 * the Graph API's message shapes.
 *
 * Kill switch: WHATSAPP_ENABLED !== "true" returns { skipped } without a
 * network call. The worker still records the wa_messages row, so what WOULD
 * have been sent stays visible while sends are off.
 *
 * Errors are thrown, not swallowed — the send worker records them on the
 * message row and pg-boss retries with backoff. Fire-and-forget is how the
 * old SMS path broke silently in production; not here.
 */

// Graph API versions live ~2 years each (v20.0 dies 2026-09-24; v25.0 is
// current as of 2026-02). Overridable so a version bump is an env change,
// not a deploy.
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v25.0";

// Env values arrive from dashboard paste-boxes: strip whitespace and any
// literal wrapping quotes, or a stray newline becomes "%0A" in the Graph URL
// and every send dies with "Unknown path components".
const cleanEnv = (value) => String(value || "").trim().replace(/^["']|["']$/g, "");

const config = () => ({
  enabled: cleanEnv(process.env.WHATSAPP_ENABLED) === "true",
  token: cleanEnv(process.env.WHATSAPP_ACCESS_TOKEN),
  phoneNumberId: cleanEnv(process.env.WHATSAPP_PHONE_NUMBER_ID),
});

// The API addresses recipients as wa_ids: E.164 digits without the "+".
const toWaId = (phone) => String(phone || "").replace(/[^\d]/g, "");

/** Engine reply (data) → Cloud API message body. Exported for direct testing. */
const toApiPayload = (to, reply) => {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: toWaId(to) };
  switch (reply.kind) {
    case REPLY.TEXT:
      return { ...base, type: "text", text: { preview_url: false, body: reply.body } };
    case REPLY.BUTTONS:
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: reply.body },
          action: {
            buttons: reply.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })),
          },
        },
      };
    case REPLY.LIST:
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: reply.body },
          action: {
            button: reply.button,
            sections: reply.sections.map((s) => ({
              // Meta rejects an empty section title only when there are
              // multiple sections; a single unnamed section is sent without one.
              ...(s.title ? { title: s.title } : {}),
              rows: s.rows.map((r) => ({
                id: String(r.id),
                title: r.title,
                ...(r.description ? { description: r.description } : {}),
              })),
            })),
          },
        },
      };
    case REPLY.DOCUMENT:
      return {
        ...base,
        type: "document",
        document: {
          link: reply.link,
          filename: reply.filename,
          ...(reply.caption ? { caption: reply.caption } : {}),
        },
      };
    case REPLY.TEMPLATE: {
      const values = Array.isArray(reply.variables)
        ? reply.variables
        : Object.values(reply.variables || {});
      return {
        ...base,
        type: "template",
        template: {
          name: reply.name,
          language: { code: reply.language || "en" },
          ...(values.length
            ? {
                components: [
                  {
                    type: "body",
                    parameters: values.map((v) => ({ type: "text", text: String(v) })),
                  },
                ],
              }
            : {}),
        },
      };
    }
    default:
      throw new Error(`whatsapp/client: unknown reply kind "${reply.kind}"`);
  }
};

/**
 * Send one engine reply. Resolves { wamid } on acceptance, { skipped, reason }
 * when the kill switch is off, throws on any API rejection.
 */
const sendReply = async (to, reply) => {
  const { enabled, token, phoneNumberId } = config();
  if (!enabled) return { skipped: true, reason: "WHATSAPP_ENABLED is off" };
  if (!token || !phoneNumberId) {
    throw new Error("whatsapp/client: WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured");
  }

  try {
    const res = await axios.post(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      toApiPayload(to, reply),
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );
    const wamid = res.data?.messages?.[0]?.id || null;
    return { wamid };
  } catch (err) {
    // Surface Meta's actual complaint — "(#131030) Recipient not in allowed
    // list" beats "Request failed with status code 400" in a ledger row.
    const apiError = err.response?.data?.error;
    if (apiError) {
      throw new Error(`Cloud API ${apiError.code || ""}: ${apiError.message || "send rejected"}`);
    }
    throw err;
  }
};

/**
 * Mark an inbound message read (blue ticks) and show "typing…" while the
 * engine works — the two together read as "we've seen you, answer coming".
 * WhatsApp dismisses the indicator when our reply arrives, or after ~25 s.
 *
 * Strictly best-effort: returns { ok:false } instead of throwing, because a
 * cosmetic nicety must never delay or fail the actual reply.
 */
const sendTypingIndicator = async (inboundWamid) => {
  const { enabled, token, phoneNumberId } = config();
  if (!enabled || !inboundWamid || !token || !phoneNumberId) {
    return { skipped: true };
  }
  try {
    await axios.post(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: inboundWamid,
        typing_indicator: { type: "text" },
      },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.response?.data?.error?.message || err.message };
  }
};

module.exports = { sendReply, sendTypingIndicator, toApiPayload, toWaId, GRAPH_VERSION };
