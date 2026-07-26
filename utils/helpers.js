const { toE164 } = require("./phone");

/**
 * Escapes special regex characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalizes a phone number to E.164.
 *
 * @deprecated Use `utils/phone` directly. This remains only so existing
 * callers keep working; it now delegates rather than re-implementing, because
 * the old hand-rolled version assumed every number was Nigerian and silently
 * corrupted anything else.
 *
 * Note the changed contract: returns **null** for an unparseable number where
 * the old version returned a best-effort string. Callers must handle null.
 *
 * @param {string} phone
 * @returns {string|null}
 */
function normalizePhone(phone) {
  return toE164(phone);
}

/**
 * Returns uppercase initials from a full name (e.g. "John Doe" → "J D").
 * @param {string} name
 * @returns {string}
 */
function getCustomerInitials(name) {
  if (!name) return "";
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase())
    .join(" ");
}

module.exports = { escapeRegex, normalizePhone, getCustomerInitials };
