const crypto = require("crypto");
const { CSRF_COOKIE, CSRF_HEADER, COOKIES } = require("../services/cookie.service");

/**
 * Double-submit CSRF protection for cookie-borne refresh tokens.
 *
 * The attack this closes: once a refresh token lives in a cookie, the browser
 * attaches it to a cross-site POST automatically, so any page on the internet
 * could silently mint tokens for a logged-in user. The defence is to require a
 * value the attacker cannot read — same-origin policy stops a cross-site page
 * reading our cookie, so it cannot reproduce it in a header.
 *
 * This is layered under SameSite, which already blocks the cross-site POST on
 * its own. Both are here because SameSite has to be relaxed to `None` if the
 * portal is ever served from a different registrable domain, and the CSRF
 * check must not quietly become the only thing standing there.
 */

function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Enforce the double submit only when the refresh token actually arrived in a
 * cookie.
 *
 * A caller sending the token in the request body is not exposed to CSRF at all
 * — an attacker who could supply the token would not need CSRF — so demanding
 * a header there would break native clients for no security gain.
 */
function requireCsrfForCookieAuth(realm) {
  const cookieName = COOKIES[realm]?.name;
  if (!cookieName) throw new TypeError(`csrf: unknown realm ${JSON.stringify(realm)}`);

  return (req, res, next) => {
    const bodyToken = req.body?.refreshToken;
    if (typeof bodyToken === "string" && bodyToken) return next();

    const refreshCookie = req.cookies?.[cookieName];
    if (!refreshCookie) return next(); // nothing to protect; the handler will 4xx

    const headerValue = req.get(CSRF_HEADER);
    const cookieValue = req.cookies?.[CSRF_COOKIE];

    if (!headerValue || !cookieValue || !timingSafeEqualStrings(headerValue, cookieValue)) {
      return res.status(403).json({ success: false, message: "Invalid CSRF token" });
    }
    next();
  };
}

module.exports = { requireCsrfForCookieAuth, timingSafeEqualStrings };
