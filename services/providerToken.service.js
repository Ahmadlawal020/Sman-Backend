const crypto = require("crypto");
const axios = require("axios");
const jwt = require("jsonwebtoken");

// Verifies ID tokens from external identity providers (Google, Apple).
//
// The frontend runs the provider's own sign-in SDK and sends us the resulting
// ID token; we verify its signature against the provider's published JWKS and
// check issuer + audience. No client secrets are involved — only the client
// IDs, which are public by nature but still configured, because an audience
// check against someone else's app id must fail.

const PROVIDERS = {
  google: {
    jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    audienceEnv: "GOOGLE_CLIENT_ID",
  },
  apple: {
    jwksUrl: "https://appleid.apple.com/auth/keys",
    issuers: ["https://appleid.apple.com"],
    audienceEnv: "APPLE_CLIENT_ID",
  },
};

// JWKS cache: providers rotate keys rarely; an hour keeps login latency flat
// without holding stale keys past rotation.
const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCache = new Map();

async function fetchJwks(provider) {
  const cached = jwksCache.get(provider);
  if (cached && cached.fetchedAt > Date.now() - JWKS_TTL_MS) return cached.keys;

  const { data } = await axios.get(PROVIDERS[provider].jwksUrl, { timeout: 10000 });
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  jwksCache.set(provider, { keys, fetchedAt: Date.now() });
  return keys;
}

function isEnabled(provider) {
  const config = PROVIDERS[provider];
  return Boolean(config && process.env[config.audienceEnv]);
}

/**
 * Verify a provider ID token. Returns
 *   { ok: true, sub, email, emailVerified, name }
 * or
 *   { ok: false, reason }
 * Reasons stay in logs; callers answer clients generically.
 */
async function verifyIdToken(provider, idToken) {
  const config = PROVIDERS[provider];
  if (!config) return { ok: false, reason: `unknown provider ${provider}` };

  const audience = process.env[config.audienceEnv];
  if (!audience) return { ok: false, reason: `${config.audienceEnv} is not configured` };
  if (typeof idToken !== "string" || !idToken) return { ok: false, reason: "missing token" };

  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header?.kid) return { ok: false, reason: "malformed token" };

  let keys = await fetchJwks(provider);
  let jwk = keys.find((k) => k.kid === decoded.header.kid);
  if (!jwk) {
    // Key rotation between cache refreshes: refetch once before giving up.
    jwksCache.delete(provider);
    keys = await fetchJwks(provider);
    jwk = keys.find((k) => k.kid === decoded.header.kid);
    if (!jwk) return { ok: false, reason: "unknown signing key" };
  }

  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  } catch (err) {
    return { ok: false, reason: `bad JWK: ${err.message}` };
  }

  try {
    const payload = jwt.verify(idToken, publicKey, {
      algorithms: ["RS256"],
      audience,
      issuer: config.issuers,
    });
    return {
      ok: true,
      sub: String(payload.sub),
      email: typeof payload.email === "string" ? payload.email.toLowerCase() : null,
      emailVerified: payload.email_verified === true || payload.email_verified === "true",
      name: typeof payload.name === "string" ? payload.name : null,
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = { verifyIdToken, isEnabled, PROVIDERS };
