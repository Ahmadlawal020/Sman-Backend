const { eq, lt, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { waSessions } = require("../db/schema");

/**
 * One live conversation per phone. Expiry is explicit (Postgres has no TTL
 * index): a session past `expires_at` is EXPIRED — the pipeline flags it so
 * the engine can offer resume — and the sweep deletes it only after a grace
 * period, because deleting at expiry would destroy the cart the resume offer
 * needs.
 */

const SESSION_TTL_MINUTES = 30; // idle time before a cart goes stale
const RESUME_GRACE_HOURS = 24; // how long an expired cart stays resumable

const freshExpiry = () => new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);

/** The session for a phone — expired or not; the caller decides what expiry means. */
const findByPhone = async (waPhone) => {
  const [row] = await db.select().from(waSessions).where(eq(waSessions.waPhone, waPhone)).limit(1);
  return row || null;
};

/**
 * Persist the engine's returned session for this phone, bumping the idle
 * expiry. Upsert on wa_phone: the engine neither knows nor cares whether a
 * row existed.
 */
const save = async (waPhone, { customerId, state, cart, lastOrderId }) => {
  const values = {
    waPhone,
    customerId: customerId ?? null,
    state,
    cart: cart ?? {},
    lastOrderId: lastOrderId ?? null,
    expiresAt: freshExpiry(),
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(waSessions)
    .values(values)
    .onConflictDoUpdate({ target: waSessions.waPhone, set: values })
    .returning();
  return row;
};

const deleteByPhone = async (waPhone) => {
  await db.delete(waSessions).where(eq(waSessions.waPhone, waPhone));
};

/**
 * The sweep: delete sessions whose resume grace has also passed. Runs on a
 * pg-boss cron; returns how many rows went, for the log line.
 */
const sweepExpired = async () => {
  const cutoff = new Date(Date.now() - RESUME_GRACE_HOURS * 60 * 60 * 1000);
  const rows = await db.delete(waSessions).where(lt(waSessions.expiresAt, cutoff)).returning({ id: waSessions.id });
  return rows.length;
};

const isExpired = (session, now = new Date()) =>
  Boolean(session && session.expiresAt && new Date(session.expiresAt) < now);

module.exports = {
  SESSION_TTL_MINUTES,
  RESUME_GRACE_HOURS,
  findByPhone,
  save,
  deleteByPhone,
  sweepExpired,
  isExpired,
};
