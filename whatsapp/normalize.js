const { INBOUND } = require("./constants");

/**
 * Meta delivers a typed text reply, a button tap and a list selection in
 * three different payload shapes; the engine should not know that. This is
 * the only file that reads Meta's inbound message format.
 *
 * Anything unreadable — voice notes, images, stickers, reactions, contacts,
 * locations, and whatever Meta ships next — normalises to `unsupported`,
 * which is a real case with a real reply, never a crash.
 */
const normalizeInbound = (message) => {
  const raw = message || {};
  switch (raw.type) {
    case "text":
      return { type: INBOUND.TEXT, value: raw.text?.body ?? "", raw };
    case "interactive": {
      const interactive = raw.interactive || {};
      if (interactive.type === "button_reply") {
        return { type: INBOUND.BUTTON, value: interactive.button_reply?.id ?? "", raw };
      }
      if (interactive.type === "list_reply") {
        return { type: INBOUND.LIST, value: interactive.list_reply?.id ?? "", raw };
      }
      return { type: INBOUND.UNSUPPORTED, value: null, raw };
    }
    // A quick-reply tap on a TEMPLATE message arrives as type "button".
    case "button":
      return { type: INBOUND.BUTTON, value: raw.button?.payload ?? raw.button?.text ?? "", raw };
    default:
      return { type: INBOUND.UNSUPPORTED, value: null, raw };
  }
};

module.exports = { normalizeInbound };
