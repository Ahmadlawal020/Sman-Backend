const jwt = require("jsonwebtoken");
const { ISSUER, ACCESS_TOKEN_TTL, secretFor } = require("../config/auth");

/**
 * Access-token minting and verification.
 *
 * Access tokens are short-lived JWTs. Refresh tokens are NOT JWTs — they are
 * opaque random strings looked up by hash (see session.repository), so signing
 * them would add nothing.
 */

/** Distinguishes "token expired" from "token rejected" for the caller. */
class TokenError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TokenError";
    this.code = code; // expired | invalid
  }
}

/**
 * @param {"staff"|"customer"} realm
 * @param {{id: number, email?: string, roles?: string[]}} principal
 * @param {number} sessionId  becomes the `sid` claim, so a token can be tied
 *                            back to a revocable session on every request
 */
function signAccessToken(realm, principal, sessionId) {
  const payload = {
    sid: sessionId,
    email: principal.email || null,
  };
  // Roles are a staff concept. Emitting an empty array for customers would
  // invite a `roles.includes(...)` check to quietly pass somewhere.
  if (realm === "staff") payload.roles = principal.roles || [];

  return jwt.sign(payload, secretFor(realm), {
    algorithm: "HS256",
    expiresIn: ACCESS_TOKEN_TTL,
    issuer: ISSUER,
    audience: realm,
    subject: String(principal.id),
  });
}

/**
 * Verify and decode. Throws TokenError rather than returning null, so a
 * caller cannot accidentally treat a failure as an anonymous request.
 *
 * `algorithms` is pinned: without it, a token whose header says `alg: none`
 * or a public-key algorithm can be crafted to bypass verification entirely.
 * `audience` is what stops a customer token being accepted by a staff route.
 *
 * @returns {{id: number, email: string|null, roles: string[], sid: number}}
 */
function verifyAccessToken(realm, token) {
  let decoded;
  try {
    decoded = jwt.verify(token, secretFor(realm), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: realm,
    });
  } catch (err) {
    if (err.name === "TokenExpiredError") throw new TokenError("expired", "Token expired");
    throw new TokenError("invalid", "Invalid token");
  }

  const id = Number(decoded.sub);
  if (!Number.isInteger(id) || id <= 0) {
    throw new TokenError("invalid", "Invalid token subject");
  }
  if (!Number.isInteger(decoded.sid)) {
    throw new TokenError("invalid", "Token is not bound to a session");
  }

  return {
    id,
    email: decoded.email ?? null,
    roles: Array.isArray(decoded.roles) ? decoded.roles : [],
    sid: decoded.sid,
  };
}

module.exports = { TokenError, signAccessToken, verifyAccessToken };
