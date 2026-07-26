/**
 * Escapes special regex characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// `normalizePhone` lived here as a deprecated alias for utils/phone's toE164.
// Its only caller now imports toE164 directly, so the indirection is gone.

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

module.exports = { escapeRegex, getCustomerInitials };
