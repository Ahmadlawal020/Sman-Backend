const express = require("express");
const router = express.Router();

/**
 * GET /app — store redirect for the "Download mobile app" links.
 *
 * WhatsApp (and chat in general) gives no signal about the customer's device,
 * so the bot sends ONE public URL and the choice happens here, at click time,
 * from the browser's User-Agent. Unknown devices — desktop browsers, bots —
 * fall back to the website (then the portal) rather than a store page that
 * would refuse to install.
 *
 * Deliberately env-driven and side-effect free: no logging of the UA beyond
 * the request logger, no query params carried through to the stores.
 */
router.get("/", (req, res) => {
  const ua = String(req.get("user-agent") || "");
  const ios = (process.env.APP_STORE_IOS_URL || "").trim();
  const android = (process.env.APP_STORE_ANDROID_URL || "").trim();
  const fallback =
    (process.env.SOROMAN_WEBSITE_URL || "").trim() ||
    (process.env.CLIENT_URL || "").trim();

  // iPads on iOS 13+ present as "Macintosh"; the touch-capable Mac UA is the
  // tell. Checked before Android because some in-app browsers stack tokens.
  const isIos = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua));
  const isAndroid = /Android/i.test(ua);

  const target = (isIos && ios) || (isAndroid && android) || fallback;
  if (!target) {
    // Nothing configured at all — an honest 404 beats a redirect loop.
    return res.status(404).json({ success: false, message: "App download is not configured" });
  }
  return res.redirect(302, target);
});

module.exports = router;
