const { eq, and, sql, gt } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  customerIdentities,
  customerTrustedDevices,
  customerPasskeys,
  webauthnChallenges,
} = require("../db/schema");

// ── Identities ───────────────────────────────────────────────────────────────

const findByProviderUserId = async (provider, providerUserId) => {
  const [row] = await db
    .select()
    .from(customerIdentities)
    .where(
      and(
        eq(customerIdentities.provider, provider),
        eq(customerIdentities.providerUserId, providerUserId)
      )
    )
    .limit(1);
  return row || null;
};

const findByCustomerAndProvider = async (customerId, provider) => {
  const [row] = await db
    .select()
    .from(customerIdentities)
    .where(
      and(
        eq(customerIdentities.customerId, customerId),
        eq(customerIdentities.provider, provider)
      )
    )
    .limit(1);
  return row || null;
};

const listByCustomer = async (customerId) => {
  return db
    .select()
    .from(customerIdentities)
    .where(eq(customerIdentities.customerId, customerId));
};

const create = async (data) => {
  const [row] = await db.insert(customerIdentities).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const [row] = await db
    .update(customerIdentities)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(customerIdentities.id, id))
    .returning();
  return row || null;
};

const deleteById = async (id) => {
  const [row] = await db
    .delete(customerIdentities)
    .where(eq(customerIdentities.id, id))
    .returning();
  return row || null;
};

const recordFailedAttempt = async (id, { lockAfter, lockMinutes }) => {
  const [row] = await db
    .update(customerIdentities)
    .set({
      failedAttempts: sql`${customerIdentities.failedAttempts} + 1`,
      lockedUntil: sql`CASE WHEN ${customerIdentities.failedAttempts} + 1 >= ${lockAfter}
        THEN now() + make_interval(mins => ${lockMinutes}) ELSE ${customerIdentities.lockedUntil} END`,
      updatedAt: new Date(),
    })
    .where(eq(customerIdentities.id, id))
    .returning();
  return row || null;
};

const resetFailures = async (id) => {
  await db
    .update(customerIdentities)
    .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(customerIdentities.id, id));
};

// ── Trusted devices ──────────────────────────────────────────────────────────

const createTrustedDevice = async (data) => {
  const [row] = await db.insert(customerTrustedDevices).values(data).returning();
  return row;
};

const findLiveTrustedDevice = async (tokenHash) => {
  const [row] = await db
    .select()
    .from(customerTrustedDevices)
    .where(
      and(
        eq(customerTrustedDevices.tokenHash, tokenHash),
        gt(customerTrustedDevices.expiresAt, sql`now()`)
      )
    )
    .limit(1);
  return row || null;
};

const touchTrustedDevice = async (id) => {
  await db
    .update(customerTrustedDevices)
    .set({ lastUsedAt: new Date() })
    .where(eq(customerTrustedDevices.id, id));
};

const listTrustedDevices = async (customerId) => {
  return db
    .select()
    .from(customerTrustedDevices)
    .where(
      and(
        eq(customerTrustedDevices.customerId, customerId),
        gt(customerTrustedDevices.expiresAt, sql`now()`)
      )
    );
};

const revokeTrustedDevice = async (customerId, id) => {
  const [row] = await db
    .delete(customerTrustedDevices)
    .where(and(eq(customerTrustedDevices.id, id), eq(customerTrustedDevices.customerId, customerId)))
    .returning();
  return row || null;
};

// ── Passkeys ─────────────────────────────────────────────────────────────────

const createPasskey = async (data) => {
  const [row] = await db.insert(customerPasskeys).values(data).returning();
  return row;
};

const findPasskeyByCredentialId = async (credentialId) => {
  const [row] = await db
    .select()
    .from(customerPasskeys)
    .where(eq(customerPasskeys.credentialId, credentialId))
    .limit(1);
  return row || null;
};

const listPasskeys = async (customerId) => {
  return db.select().from(customerPasskeys).where(eq(customerPasskeys.customerId, customerId));
};

const updatePasskey = async (id, data) => {
  const [row] = await db
    .update(customerPasskeys)
    .set(data)
    .where(eq(customerPasskeys.id, id))
    .returning();
  return row || null;
};

const deletePasskey = async (customerId, id) => {
  const [row] = await db
    .delete(customerPasskeys)
    .where(and(eq(customerPasskeys.id, id), eq(customerPasskeys.customerId, customerId)))
    .returning();
  return row || null;
};

// ── WebAuthn challenges (one-shot) ───────────────────────────────────────────

const createChallenge = async (data) => {
  const [row] = await db.insert(webauthnChallenges).values(data).returning();
  return row;
};

/**
 * Atomically consume a live challenge; a second consumer gets null. This is
 * the guard against replaying a ceremony response.
 */
const consumeChallenge = async (challenge, purpose) => {
  const [row] = await db
    .update(webauthnChallenges)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(webauthnChallenges.challenge, challenge),
        eq(webauthnChallenges.purpose, purpose),
        sql`${webauthnChallenges.consumedAt} IS NULL`,
        gt(webauthnChallenges.expiresAt, sql`now()`)
      )
    )
    .returning();
  return row || null;
};

module.exports = {
  findByProviderUserId,
  findByCustomerAndProvider,
  listByCustomer,
  create,
  update,
  deleteById,
  recordFailedAttempt,
  resetFailures,
  createTrustedDevice,
  findLiveTrustedDevice,
  touchTrustedDevice,
  listTrustedDevices,
  revokeTrustedDevice,
  createPasskey,
  findPasskeyByCredentialId,
  listPasskeys,
  updatePasskey,
  deletePasskey,
  createChallenge,
  consumeChallenge,
};
