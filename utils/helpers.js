/**
 * Escapes special regex characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalizes a Nigerian phone number to 234XXXXXXXXXX format.
 * @param {string} phone
 * @returns {string}
 */
function normalizePhone(phone) {
  if (!phone) return phone;
  let cleaned = phone.replace(/[\s\-()+]/g, "");
  if (cleaned.startsWith("0")) cleaned = "234" + cleaned.slice(1);
  if (/^[789]\d{9}$/.test(cleaned)) cleaned = "234" + cleaned;
  return cleaned;
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
