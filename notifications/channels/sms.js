const { sendSMSTermii, CHANNELS } = require("../../services/sms.service");

/**
 * SMS, over Termii — through services/sms.service.js rather than around it, so
 * the API shape, the phone normalisation and the SMS_ENABLED kill switch all
 * stay in one place.
 *
 * The generic → dnd fallback is preserved from the bespoke senders in that
 * file. Termii's `generic` route is the transactional one and the only route
 * that reaches numbers on Nigeria's Do-Not-Disturb list is `dnd`; trying
 * generic first keeps the cheaper route as the default, and falling back means
 * a DND-registered customer still receives their payment confirmation instead
 * of silently receiving nothing.
 */

/**
 * A single GSM-7 SMS is 160 characters, and 153 per part once concatenated.
 * Termii bills per part, so an unbounded template is an unbounded invoice —
 * this caps the damage at four parts and makes truncation visible rather than
 * letting a runaway template quietly cost money.
 */
const MAX_LENGTH = Number(process.env.NOTIFY_SMS_MAX_LENGTH || 612);

const truncate = (text) => {
  const s = String(text || "").trim();
  return s.length <= MAX_LENGTH ? s : `${s.slice(0, MAX_LENGTH - 1)}…`;
};

/**
 * @returns {Promise<Array<{destination, status, providerMessageId, error}>>}
 */
const send = async ({ contact, rendered }) => {
  const phone = String(contact?.phone || "").trim();

  if (!phone) {
    return [{ destination: "", status: "skipped", error: "No phone number on file" }];
  }

  const text = truncate(rendered.sms);
  if (!text) {
    return [{ destination: phone, status: "skipped", error: "No SMS template for this type" }];
  }

  const attempts = [];
  for (const channel of [CHANNELS.GENERIC, CHANNELS.DND]) {
    try {
      const result = await sendSMSTermii(phone, text, channel);
      if (result.success) {
        return [
          { destination: phone, status: "sent", providerMessageId: result.messageId || "", error: null },
        ];
      }
      attempts.push(`${channel}: ${result.message || "failed"}`);
    } catch (err) {
      // Termii returns its real complaint in the response body; err.message
      // alone is usually just "Request failed with status code 400".
      const detail = err.response?.data?.message || err.message || "Termii error";
      attempts.push(`${channel}: ${detail}`);
    }
  }

  return [
    {
      destination: phone,
      status: "failed",
      providerMessageId: "",
      error: attempts.join(" | ") || "All Termii channels failed",
    },
  ];
};

module.exports = { send, MAX_LENGTH };
