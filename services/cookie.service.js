const crypto = require("crypto");
const { refreshTtlMs } = require("../config/auth");

/**
 * Refresh-token cookie transport.
 *
 * The point of a cookie here is `httpOnly`: a refresh token in localStorage is
 * readable by any XSS on the page, whereas an httpOnly cookie is not. The cost
 * is CSRF exposure, which middleware/csrf.js closes.
 *
 * Transport is hybrid because native apps handle cookies poorly. The cookie is
 * always set; whether the token ALSO comes back in the response body is the
 * client's choice, declared per request.
 */

/**
 * Per-realm names and paths.
 *
 * Path scoping is deliberate: a cookie scoped to /api/auth is not attached to
 * requests for /api/customer/auth, so a staff refresh token is never even
 * transmitted to a customer endpoint.
 */
const COOKIES = {
  staff: { name: "soroman_staff_refresh", path: "/api/auth" },
  customer: { name: "soroman_customer_refresh", path: "/api/customer/auth" },
};

/** Readable by JavaScript on purpose — the client must echo it in a header. */
const CSRF_COOKIE = "soroman_csrf";
const CSRF_HEADER = "x-csrf-token";

function cookieFor(realm) {
  const config = COOKIES[realm];
  if (!config) throw new TypeError(`cookie.service: unknown realm ${JSON.stringify(realm)}`);
  return config;
}

/**
 * `SameSite=Strict` by default, which alone blocks the cross-site POST that
 * CSRF depends on. Configurable because a portal served from a different
 * registrable domain needs `None` — and `None` requires `Secure`, so that
 * combination only works over HTTPS.
 */
function sameSite() {
  const raw = (process.env.COOKIE_SAMESITE || "strict").toLowerCase();
  return ["strict", "lax", "none"].includes(raw) ? raw : "strict";
}

function isSecure() {
  // Off in development so the cookie works over plain http on localhost.
  // SameSite=None is meaningless without Secure, so force it in that case.
  return process.env.NODE_ENV === "production" || sameSite() === "none";
}

/**
 * Does this client want the refresh token in the response body?
 *
 * Default is yes, which is not the safer option — it is the non-breaking one.
 * The existing dashboard reads `data.refreshToken`, so flipping the default
 * would break it on deploy. A client opts into cookie-only with
 * `X-Auth-Transport: cookie`, and once the dashboard does, the body token
 * should be dropped entirely.
 */
function wantsBodyToken(req) {
  return String(req.get("x-auth-transport") || "").toLowerCase() !== "cookie";
}

function setRefreshCookie(res, realm, token) {
  const { name, path } = cookieFor(realm);
  res.cookie(name, token, {
    httpOnly: true,
    secure: isSecure(),
    sameSite: sameSite(),
    path,
    maxAge: refreshTtlMs(realm),
  });
}

/**
 * Issue a CSRF token alongside the refresh cookie. Not httpOnly — the client
 * has to read it to echo it back, which is the whole double-submit mechanism.
 */
function setCsrfCookie(res, realm) {
  const token = crypto.randomBytes(32).toString("base64url");
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: isSecure(),
    sameSite: sameSite(),
    path: cookieFor(realm).path,
    maxAge: refreshTtlMs(realm),
  });
  return token;
}

function clearRefreshCookie(res, realm) {
  const { name, path } = cookieFor(realm);
  res.clearCookie(name, { httpOnly: true, secure: isSecure(), sameSite: sameSite(), path });
  res.clearCookie(CSRF_COOKIE, { secure: isSecure(), sameSite: sameSite(), path });
}

/** Read the presented refresh token: body first, then cookie. */
function readRefreshToken(req, realm) {
  const fromBody = req.body?.refreshToken;
  if (typeof fromBody === "string" && fromBody) return { token: fromBody, fromCookie: false };

  const fromCookie = req.cookies?.[cookieFor(realm).name];
  if (typeof fromCookie === "string" && fromCookie) return { token: fromCookie, fromCookie: true };

  return { token: null, fromCookie: false };
}

/**
 * In-process tally of how tokens are being transported, per realm.
 *
 * The body-token path is scheduled for removal, and "remove it once the
 * dashboard has migrated" is the kind of conditional that never resolves —
 * nobody can prove it is safe to delete. This makes it provable: when
 * `body` has been 0 across a full release cycle, the code path can go.
 *
 * Counters are per-process and reset on deploy, so they are a signal, not an
 * audit. The log lines are the durable record.
 */
const transportCounts = {
  staff: { cookie: 0, body: 0 },
  customer: { cookie: 0, body: 0 },
};

function recordTransport(req, realm, mode) {
  transportCounts[realm][mode] += 1;

  // One line per token issuance — login and refresh only, not every request.
  // The user agent is included truncated because the actionable question is
  // *which client* still needs migrating, and it is already stored on the
  // session row anyway.
  const ua = String(req.get("user-agent") || "unknown").slice(0, 80);
  console.info(
    `[auth.transport] realm=${realm} transport=${mode} path=${req.originalUrl} ua="${ua}"`
  );
}

/** Snapshot for diagnostics. */
const getTransportCounts = () => JSON.parse(JSON.stringify(transportCounts));

/**
 * Attach a freshly issued token to the response, honouring the client's
 * declared transport. Returns what the body should carry, if anything.
 */
function applyIssuedToken(req, res, realm, refreshToken) {
  setRefreshCookie(res, realm, refreshToken);
  setCsrfCookie(res, realm);

  const useBody = wantsBodyToken(req);
  recordTransport(req, realm, useBody ? "body" : "cookie");

  return useBody ? refreshToken : undefined;
}

module.exports = {
  COOKIES,
  CSRF_COOKIE,
  CSRF_HEADER,
  sameSite,
  isSecure,
  wantsBodyToken,
  getTransportCounts,
  setRefreshCookie,
  setCsrfCookie,
  clearRefreshCookie,
  readRefreshToken,
  applyIssuedToken,
};
