const crypto = require("crypto");

/**
 * Central auth configuration. Secrets, TTLs and the boot assertions that keep
 * the two realms genuinely separate.
 */

const ISSUER = "soroman";

const ACCESS_TOKEN_TTL = "15m";

/** Refresh lifetimes. Staff sessions are shorter because staff hold power. */
const REFRESH_TTL_MS = {
  staff: 7 * 24 * 60 * 60 * 1000,
  customer: 30 * 24 * 60 * 60 * 1000,
};

/**
 * How long a just-rotated refresh token stays replayable.
 *
 * Without this, a dropped response is indistinguishable from theft: the client
 * never received the new token, retries with the old one, and reuse detection
 * logs the user out of every device. 60 seconds covers a retry without giving
 * a stolen token a useful window.
 */
const ROTATION_GRACE_MS = 60 * 1000;

const isProduction = () => process.env.NODE_ENV === "production";

let cached = null;

/**
 * Resolve the per-realm signing secrets.
 *
 * Staff falls back to the legacy ACCESS_TOKEN_SECRET so existing deployments
 * and CI keep working through the rename.
 *
 * Customer has no such fallback — it must never silently share the staff
 * secret, because a shared secret means a customer token verifies as a staff
 * token wherever an `aud` check is missed. In non-production it is derived
 * from the staff secret so local development works without new config; in
 * production it must be set explicitly, and boot fails otherwise.
 */
function secrets() {
  if (cached) return cached;

  const staff = process.env.STAFF_ACCESS_TOKEN_SECRET || process.env.ACCESS_TOKEN_SECRET;
  if (!staff) {
    throw new Error(
      "Fatal: STAFF_ACCESS_TOKEN_SECRET (or legacy ACCESS_TOKEN_SECRET) must be set"
    );
  }

  let customer = process.env.CUSTOMER_ACCESS_TOKEN_SECRET;
  if (!customer) {
    if (isProduction()) {
      throw new Error("Fatal: CUSTOMER_ACCESS_TOKEN_SECRET must be set in production");
    }
    // Deterministic, distinct from the staff secret, and impossible to reach
    // in production. Convenience for local dev only.
    customer = crypto.createHash("sha256").update(`${staff}:customer-realm`).digest("hex");
    console.warn(
      "[auth] CUSTOMER_ACCESS_TOKEN_SECRET is unset; deriving one for development. " +
        "Set it explicitly before deploying."
    );
  }

  if (staff === customer) {
    throw new Error(
      "Fatal: STAFF_ACCESS_TOKEN_SECRET and CUSTOMER_ACCESS_TOKEN_SECRET must differ. " +
        "A shared secret lets a customer token verify as a staff token wherever an audience check is missed."
    );
  }

  cached = { staff, customer };
  return cached;
}

/** Test seam — secrets are memoised, so changing env mid-process needs a reset. */
function resetSecretsCache() {
  cached = null;
}

function secretFor(realm) {
  const resolved = secrets();
  if (!Object.prototype.hasOwnProperty.call(resolved, realm)) {
    throw new TypeError(`config/auth: unknown realm ${JSON.stringify(realm)}`);
  }
  return resolved[realm];
}

function refreshTtlMs(realm) {
  const ttl = REFRESH_TTL_MS[realm];
  if (!ttl) throw new TypeError(`config/auth: unknown realm ${JSON.stringify(realm)}`);
  return ttl;
}

module.exports = {
  ISSUER,
  ACCESS_TOKEN_TTL,
  REFRESH_TTL_MS,
  ROTATION_GRACE_MS,
  secrets,
  secretFor,
  refreshTtlMs,
  resetSecretsCache,
};
