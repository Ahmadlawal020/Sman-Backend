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

/**
 * Generates standardized order reference: INITIALS/ORDER_ID
 *
 * Initials extracted from company name:
 * - Multiple words: first letter of each word ("Honeywell Adada" → "HA")
 * - Single word: first 2 letters ("Soroman" → "SO")
 * - Default: "SO" if no company name
 *
 * @param {string|null} companyName - Customer's company name
 * @param {number|string} orderId - Order ID
 * @returns {string} Order reference (e.g., "HA/10831")
 */
function generateOrderReference(companyName, orderId) {
  let initials = "SO";

  if (companyName && typeof companyName === "string" && companyName.trim()) {
    const words = companyName.trim().split(/\s+/).filter(Boolean);

    if (words.length > 1) {
      initials = words.map((w) => w.charAt(0).toUpperCase()).slice(0, 2).join("");
    } else if (words.length === 1) {
      initials = words[0].substring(0, 2).toUpperCase();
    }
  }

  return `${initials}/${orderId}`;
}

module.exports = { escapeRegex, getCustomerInitials, generateOrderReference };
