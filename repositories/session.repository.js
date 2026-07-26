const crypto = require("crypto");
const { eq, and, isNull, gt, desc, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { sessions, staff, customers } = require("../db/schema");

const PRINCIPAL_TABLES = { staff, customer: customers };

const REALMS = Object.freeze(["staff", "customer"]);

/**
 * Every exported function that touches a principal takes `realm` first and
 * resolves it here, in exactly one place. Nothing in this module reads
 * sessions.staffId or sessions.customerId directly.
 *
 * The realm is never defaulted. A missing realm is a caller bug, and defaulting
 * it would silently query the wrong column — the exact failure the exclusive
 * arc exists to make impossible.
 */
function assertRealm(realm) {
  if (!REALMS.includes(realm)) {
    throw new TypeError(
      `session.repository: realm must be one of ${REALMS.join("|")}, got ${JSON.stringify(realm)}`
    );
  }
}

function principalColumn(realm) {
  assertRealm(realm);
  return realm === "staff" ? sessions.staffId : sessions.customerId;
}

/**
 * sha256(realm + ":" + token), lowercase hex.
 *
 * Domain separation means a token minted for one realm cannot match a stored
 * row in the other even if a query omits its realm predicate. Plain SHA-256 is
 * correct here — the token is 32 bytes of CSPRNG output, so there is no
 * low-entropy input for a slow KDF to protect.
 */
function hashToken(realm, token) {
  assertRealm(realm);
  if (typeof token !== "string" || token.length === 0) {
    throw new TypeError("session.repository: token must be a non-empty string");
  }
  return crypto.createHash("sha256").update(`${realm}:${token}`).digest("hex");
}

/** 32 bytes of CSPRNG, base64url — opaque, never parsed. */
function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

const create = async (
  realm,
  principalId,
  { token, familyId, expiresAt, deviceName = "", userAgent = null, ipAddress = null },
  tx = db
) => {
  assertRealm(realm);
  const [row] = await tx
    .insert(sessions)
    .values({
      principalType: realm,
      staffId: realm === "staff" ? principalId : null,
      customerId: realm === "customer" ? principalId : null,
      refreshTokenHash: hashToken(realm, token),
      familyId: familyId || crypto.randomUUID(),
      expiresAt,
      deviceName,
      userAgent,
      ipAddress,
    })
    .returning();
  return row;
};

/**
 * Look up by token. Returns the row whatever its state — revoked, expired or
 * live — because the caller needs to distinguish "expired" from "reused", and
 * a repository that filters those out cannot tell them apart.
 */
const findByToken = async (realm, token, tx = db) => {
  const [row] = await tx
    .select()
    .from(sessions)
    .where(eq(sessions.refreshTokenHash, hashToken(realm, token)))
    .limit(1);
  return row || null;
};

const findById = async (id, tx = db) => {
  const [row] = await tx.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return row || null;
};

/**
 * Session and its owner in one round trip.
 *
 * This runs on every authenticated request, and the database is network-
 * attached (Neon), so a second round trip is not free the way it would be
 * against a local Postgres. Joining halves it without introducing a cache —
 * caching would trade a provably correct revocation check for one whose
 * correctness depends on invalidation never being missed.
 *
 * The join is on the realm's own arc column, so a customer session queried
 * with realm "staff" joins against a NULL staff_id and returns nothing. Realm
 * confusion is structurally impossible here rather than merely checked.
 *
 * @returns {{session: object, principal: object}|null}
 */
const findWithPrincipal = async (realm, id) => {
  assertRealm(realm);
  const principalTable = PRINCIPAL_TABLES[realm];

  const [row] = await db
    .select({ session: sessions, principal: principalTable })
    .from(sessions)
    .innerJoin(principalTable, eq(principalColumn(realm), principalTable.id))
    .where(and(eq(sessions.id, id), eq(sessions.principalType, realm)))
    .limit(1);

  return row || null;
};

/** Live sessions only — the "your devices" list. */
const listActive = async (realm, principalId) => {
  return db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.principalType, realm),
        eq(principalColumn(realm), principalId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, sql`now()`)
      )
    )
    .orderBy(desc(sessions.lastUsedAt), desc(sessions.createdAt));
};

/**
 * Guarded revoke. The `revoked_at IS NULL` predicate makes this the atomic
 * primitive rotation is built on: exactly one concurrent caller gets the row
 * back, everyone else gets undefined and knows it lost the race.
 */
const revokeById = async (id, reason, { replacedById = null } = {}, tx = db) => {
  // replacedById is set in the SAME update as revokedAt, never afterwards.
  // A revoked row that briefly has no successor recorded looks exactly like a
  // reuse attempt to the grace-window check, so a concurrent replay landing in
  // that gap would revoke the whole family for no reason.
  const patch = { revokedAt: sql`now()`, revokedReason: reason };
  if (replacedById !== null) patch.replacedById = replacedById;

  const [row] = await tx
    .update(sessions)
    .set(patch)
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
    .returning();
  return row || null;
};

/**
 * Revoke a session owned by this principal. Scoped in the WHERE, so one
 * customer cannot revoke another's device by guessing an id.
 */
const revokeOwnedById = async (realm, principalId, id, reason) => {
  const [row] = await db
    .update(sessions)
    .set({ revokedAt: sql`now()`, revokedReason: reason })
    .where(
      and(
        eq(sessions.id, id),
        eq(sessions.principalType, realm),
        eq(principalColumn(realm), principalId),
        isNull(sessions.revokedAt)
      )
    )
    .returning();
  return row || null;
};

/** Every live session for a principal — logout-all, deactivation, phone change. */
const revokeAllForPrincipal = async (realm, principalId, reason, tx = db) => {
  return tx
    .update(sessions)
    .set({ revokedAt: sql`now()`, revokedReason: reason })
    .where(
      and(
        eq(sessions.principalType, realm),
        eq(principalColumn(realm), principalId),
        isNull(sessions.revokedAt)
      )
    )
    .returning({ id: sessions.id });
};

/**
 * Kill an entire rotation family. Used on reuse detection: if a stolen token is
 * replayed we cannot tell attacker from victim, so every descendant goes.
 */
const revokeFamily = async (familyId, reason, tx = db) => {
  return tx
    .update(sessions)
    .set({ revokedAt: sql`now()`, revokedReason: reason })
    .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
};

const touch = async (id, tx = db) => {
  const [row] = await tx
    .update(sessions)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(sessions.id, id))
    .returning();
  return row || null;
};

/** Housekeeping — rows past expiry are unrecoverable, so they are removable. */
const deleteExpiredBefore = async (cutoff) => {
  return db
    .delete(sessions)
    .where(sql`${sessions.expiresAt} < ${cutoff}`)
    .returning({ id: sessions.id });
};

module.exports = {
  REALMS,
  assertRealm,
  hashToken,
  generateToken,
  create,
  findByToken,
  findById,
  findWithPrincipal,
  listActive,
  revokeById,
  revokeOwnedById,
  revokeAllForPrincipal,
  revokeFamily,
  touch,
  deleteExpiredBefore,
};
