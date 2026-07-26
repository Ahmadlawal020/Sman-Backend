const crypto = require("crypto");
const { sessionRepo, staffRepo, customerRepo } = require("../repositories");
const { signAccessToken } = require("./token.service");
const { refreshTtlMs, ROTATION_GRACE_MS } = require("../config/auth");

/**
 * Session lifecycle: issue, rotate, revoke.
 *
 * Rotation is the security-critical part. Every refresh mints a new token and
 * revokes the old one, so a stolen token is only useful until the legitimate
 * client next refreshes — at which point the theft becomes *detectable*,
 * because two parties now hold tokens from the same family.
 */

const PRINCIPAL_REPOS = { staff: staffRepo, customer: customerRepo };

function principalRepo(realm) {
  const repo = PRINCIPAL_REPOS[realm];
  if (!repo) throw new TypeError(`session.service: unknown realm ${JSON.stringify(realm)}`);
  return repo;
}

/**
 * A principal may hold a session but still be barred from using it — suspended
 * staff, a deactivated customer. Checked on refresh and on every request, so
 * revocation takes effect immediately rather than at the next token expiry.
 */
function isPrincipalUsable(realm, principal) {
  if (!principal) return false;
  if (realm === "staff") return principal.isActive === true && principal.suspended !== true;
  return principal.status !== "Inactive";
}

function requestContext(req) {
  return {
    userAgent: req?.headers?.["user-agent"] || null,
    ipAddress: req?.ip || null,
    deviceName: "",
  };
}

/**
 * Start a new session and return both tokens.
 * The refresh token's plaintext exists only here and in the response — the
 * database holds nothing but its hash.
 */
async function issue(realm, principal, context = {}) {
  const token = sessionRepo.generateToken();
  const session = await sessionRepo.create(realm, principal.id, {
    token,
    familyId: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + refreshTtlMs(realm)),
    deviceName: context.deviceName || "",
    userAgent: context.userAgent || null,
    ipAddress: context.ipAddress || null,
  });

  return {
    accessToken: signAccessToken(realm, principal, session.id),
    refreshToken: token,
    session,
  };
}

/** Mint a successor inside an existing family. */
async function issueWithin(realm, principalId, familyId, context = {}) {
  const token = sessionRepo.generateToken();
  const session = await sessionRepo.create(realm, principalId, {
    token,
    familyId,
    expiresAt: new Date(Date.now() + refreshTtlMs(realm)),
    deviceName: context.deviceName || "",
    userAgent: context.userAgent || null,
    ipAddress: context.ipAddress || null,
  });
  return { token, session };
}

/**
 * Rotate a refresh token.
 *
 * Returns a discriminated result rather than throwing, because the caller must
 * respond identically to every failure — distinguishing them in the response
 * would tell an attacker whether a token was merely stale or actively watched.
 *
 * @returns {{ok: true, accessToken, refreshToken, session}}
 *        | {ok: false, reason: "invalid"|"expired"|"reuse"|"principal_unusable"}
 */
async function rotate(realm, presentedToken, context = {}) {
  if (typeof presentedToken !== "string" || !presentedToken) {
    return { ok: false, reason: "invalid" };
  }

  const existing = await sessionRepo.findByToken(realm, presentedToken);
  if (!existing) return { ok: false, reason: "invalid" };

  // --- Replay of an already-rotated token -----------------------------------
  if (existing.revokedAt) {
    const age = Date.now() - new Date(existing.revokedAt).getTime();
    const withinGrace =
      existing.revokedReason === "rotated" &&
      age <= ROTATION_GRACE_MS &&
      existing.replacedById !== null;

    if (withinGrace) {
      // A dropped response, not an attack: the client never saw the successor.
      // Hand it a fresh successor rather than logging the user out everywhere.
      const successor = await sessionRepo.findById(existing.replacedById);
      if (successor && !successor.revokedAt && new Date(successor.expiresAt) > new Date()) {
        return rotateFrom(realm, successor, context);
      }
    }

    // Outside the grace window a replayed rotated token means two parties hold
    // the same lineage. We cannot tell attacker from victim, so the whole
    // family goes and both are forced to re-authenticate.
    if (existing.revokedReason === "rotated") {
      await sessionRepo.revokeFamily(existing.familyId, "reuse_detected");
      return { ok: false, reason: "reuse" };
    }

    // Revoked by logout or deactivation — already dead, nothing to escalate.
    return { ok: false, reason: "invalid" };
  }

  if (new Date(existing.expiresAt) <= new Date()) {
    return { ok: false, reason: "expired" };
  }

  return rotateFrom(realm, existing, context);
}

/**
 * The atomic core. The guarded revoke is what makes this safe under
 * concurrency: if two requests race with the same token, exactly one wins the
 * `revoked_at IS NULL` update and the loser is handled as a replay above.
 */
async function rotateFrom(realm, session, context) {
  const principalId = realm === "staff" ? session.staffId : session.customerId;
  const principal = await principalRepo(realm).findById(principalId);
  if (!isPrincipalUsable(realm, principal)) {
    await sessionRepo.revokeAllForPrincipal(realm, principalId, "principal_deactivated");
    return { ok: false, reason: "principal_unusable" };
  }

  // Order matters. The successor is created first so that revoking the old
  // session can record `replaced_by_id` in the same statement. Revoking first
  // and back-filling the successor afterwards leaves a window in which the row
  // is revoked-as-rotated but has no successor — which is indistinguishable
  // from a reuse attempt, and a concurrent replay landing there would revoke
  // the entire family for no reason.
  const { token, session: next } = await issueWithin(
    realm,
    principalId,
    session.familyId,
    context
  );

  const claimed = await sessionRepo.revokeById(session.id, "rotated", {
    replacedById: next.id,
  });
  if (!claimed) {
    // Lost the race — a concurrent request already rotated this session. The
    // successor we just minted was never handed out, so retire it rather than
    // leaving a live session nobody holds a token for.
    await sessionRepo.revokeById(next.id, "orphaned");
    return { ok: false, reason: "invalid" };
  }

  await sessionRepo.touch(next.id);

  return {
    ok: true,
    accessToken: signAccessToken(realm, principal, next.id),
    refreshToken: token,
    session: next,
  };
}

/** Revoke the session a refresh token belongs to. Idempotent. */
async function revoke(realm, presentedToken, reason = "logout") {
  if (typeof presentedToken !== "string" || !presentedToken) return null;
  const session = await sessionRepo.findByToken(realm, presentedToken);
  if (!session) return null;
  return sessionRepo.revokeById(session.id, reason);
}

const revokeAll = (realm, principalId, reason = "logout_all") =>
  sessionRepo.revokeAllForPrincipal(realm, principalId, reason);

/**
 * Per-request validation: the session must still be live AND the principal
 * still usable.
 *
 * This costs two indexed lookups per authenticated request. That is the price
 * of revocation actually taking effect — without it, a revoked session keeps
 * working until its access token expires.
 */
async function loadActive(realm, sessionId, principalId) {
  const session = await sessionRepo.findById(sessionId);
  if (!session || session.revokedAt) return { ok: false, reason: "session_revoked" };
  if (new Date(session.expiresAt) <= new Date()) return { ok: false, reason: "session_expired" };
  if (session.principalType !== realm) return { ok: false, reason: "realm_mismatch" };

  const owner = realm === "staff" ? session.staffId : session.customerId;
  if (owner !== principalId) return { ok: false, reason: "principal_mismatch" };

  const principal = await principalRepo(realm).findById(principalId);
  if (!isPrincipalUsable(realm, principal)) return { ok: false, reason: "principal_unusable" };

  return { ok: true, session, principal };
}

module.exports = {
  issue,
  rotate,
  revoke,
  revokeAll,
  loadActive,
  isPrincipalUsable,
  requestContext,
};
