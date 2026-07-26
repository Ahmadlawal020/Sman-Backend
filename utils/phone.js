/**
 * The single phone-normalisation implementation.
 *
 * Two divergent copies exist today — utils/helpers.js `normalizePhone` and
 * services/sms.service.js `formatPhoneForTermii` — which agree by coincidence
 * rather than by construction. Both are replaced by this module.
 *
 * Canonical storage form is E.164 (`+234XXXXXXXXXX`). Termii wants the same
 * digits without the `+`, so that is a rendering (`toTermii`) of one parse,
 * not a second parser.
 */

const NG_COUNTRY_CODE = "234";

function digitsOnly(input) {
  return String(input ?? "").replace(/[^\d]/g, "");
}

/**
 * Parse to the 13-digit national form, 234XXXXXXXXXX.
 *
 * Returns null when the input cannot be read as a Nigerian number. Callers
 * must handle null rather than store a mangled value — silently passing
 * through unparseable input is how a phone column ends up with three formats
 * in it.
 *
 * @param {string} phone
 * @returns {string|null}
 */
function toNationalDigits(phone) {
  const d = digitsOnly(phone);
  if (!d) return null;

  // 08012345678 — local trunk form
  if (d.length === 11 && d.startsWith("0")) return NG_COUNTRY_CODE + d.slice(1);
  // 8012345678 — trunk prefix already dropped
  if (d.length === 10 && /^[789]/.test(d)) return NG_COUNTRY_CODE + d;
  // 2348012345678 — already national
  if (d.length === 13 && d.startsWith(NG_COUNTRY_CODE)) return d;

  return null;
}

/**
 * Canonical storage form. `+234XXXXXXXXXX`, or null if unparseable.
 * @param {string} phone
 * @returns {string|null}
 */
function toE164(phone) {
  const national = toNationalDigits(phone);
  return national ? `+${national}` : null;
}

/**
 * Termii's expected form — national digits, no `+`. Empty string on failure,
 * because the SMS client treats an empty recipient as a no-op send.
 * @param {string} phone
 * @returns {string}
 */
function toTermii(phone) {
  return toNationalDigits(phone) || "";
}

/**
 * Stricter than toE164: a number we can actually send an SMS to.
 * Nigerian mobile prefixes are 70x/8xx/9xx, so landlines are rejected here
 * while still being storable.
 * @param {string} phone
 * @returns {boolean}
 */
function isValidNigerianMobile(phone) {
  const national = toNationalDigits(phone);
  return national !== null && /^234[789]\d{9}$/.test(national);
}

module.exports = { toE164, toTermii, toNationalDigits, isValidNigerianMobile };
