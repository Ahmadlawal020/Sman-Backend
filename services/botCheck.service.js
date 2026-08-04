const axios = require("axios");

/**
 * Cloudflare Turnstile verification.
 *
 * Chosen over reCAPTCHA: free, usually invisible to the user, no Google
 * dependency, and no score threshold to tune. It is one of three abuse layers
 * — Turnstile reduces volume, the country allowlist narrows the target set,
 * and the daily send cap bounds the worst case (see otp.service).
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5000;

/**
 * Turnstile is inert until the frontend renders the widget, so an unset secret
 * means "not wired up yet" and the check is skipped. server.js refuses to boot
 * in production with it unset — UNLESS the check is explicitly turned off.
 *
 * `TURNSTILE_ENABLED=false` is that off switch: it disables the bot check even
 * in production, for when the frontend has no widget yet and registrations must
 * still go through. The daily send cap and country allowlist remain the other
 * two abuse layers, so this loosens — not removes — the protection.
 */
const isEnabled = () => {
  if (process.env.TURNSTILE_ENABLED === "false") return false;
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
};

/**
 * @param {string} token   the widget's response token, from the client
 * @param {string} remoteIp
 * @returns {{ok: boolean, reason?: string, skipped?: boolean, degraded?: boolean}}
 */
async function verify(token, remoteIp) {
  if (!isEnabled()) return { ok: true, skipped: true };

  if (typeof token !== "string" || !token) {
    return { ok: false, reason: "missing_token" };
  }

  const form = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  if (remoteIp) form.append("remoteip", remoteIp);

  let data;
  try {
    const res = await axios.post(VERIFY_URL, form, { timeout: TIMEOUT_MS });
    data = res.data;
  } catch (err) {
    // In production, fail CLOSED for registration (the costlier action) — the
    // daily send cap alone is a weak gate against mass account creation.
    // In non-production, fail open so development is not blocked by Cloudflare
    // outages.
    const isProduction = process.env.NODE_ENV === "production";
    console.error(`[botCheck] Turnstile unreachable (${isProduction ? "blocking" : "allowing"}): ${err.message}`);
    return { ok: !isProduction, degraded: true };
  }

  if (data?.success === true) return { ok: true };

  return {
    ok: false,
    reason: Array.isArray(data?.["error-codes"])
      ? data["error-codes"].join(",")
      : "rejected",
  };
}

module.exports = { verify, isEnabled, VERIFY_URL };
