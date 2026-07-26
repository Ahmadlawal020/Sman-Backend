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
 * in production with it unset, so this can only be a development state.
 */
const isEnabled = () => Boolean(process.env.TURNSTILE_SECRET_KEY);

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
    // Fail OPEN. Blocking every signup because Cloudflare is unreachable is a
    // worse outcome than absorbing some bot traffic — and the daily send cap
    // still bounds what "some" can cost us.
    console.error(`[botCheck] Turnstile unreachable, allowing request: ${err.message}`);
    return { ok: true, degraded: true };
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
