const { eq, and, desc, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { waMessages } = require("../db/schema");

/**
 * The message ledger. Inbound rows are the dedupe wall (Meta retries for up
 * to 7 days; the partial unique index on wamid decides exactly once) and the
 * service-window clock; outbound rows are per-send status — queued → sent →
 * delivered → read / failed / skipped — updated by Meta's status webhooks.
 */

/**
 * Record an inbound message exactly once. Returns the new row, or null when
 * this wamid was already recorded — a Meta retry to acknowledge and ignore.
 */
const recordInbound = async ({ wamid, waPhone, sessionId = null, customerId = null, payload }) => {
  const [row] = await db
    .insert(waMessages)
    .values({ wamid, direction: "inbound", waPhone, sessionId, customerId, payload, status: "received" })
    // The wamid unique index is PARTIAL (WHERE wamid IS NOT NULL — outbound
    // rows start without one), and ON CONFLICT only matches a partial index
    // when the target repeats its predicate.
    .onConflictDoNothing({
      target: waMessages.wamid,
      where: sql`${waMessages.wamid} IS NOT NULL`,
    })
    .returning();
  return row || null;
};

const markProcessed = async (id) => {
  await db
    .update(waMessages)
    .set({ status: "processed", updatedAt: new Date() })
    .where(eq(waMessages.id, id));
};

/** An outbound reply, recorded BEFORE any send attempt. wamid arrives on success. */
const createOutbound = async ({ waPhone, sessionId = null, customerId = null, payload }) => {
  const [row] = await db
    .insert(waMessages)
    .values({ wamid: null, direction: "outbound", waPhone, sessionId, customerId, payload, status: "queued" })
    .returning();
  return row;
};

const markSent = async (id, wamid) => {
  await db
    .update(waMessages)
    .set({ status: "sent", wamid: wamid || null, updatedAt: new Date() })
    .where(eq(waMessages.id, id));
};

const markFailed = async (id, error) => {
  await db
    .update(waMessages)
    .set({ status: "failed", error: String(error || "").slice(0, 2000), updatedAt: new Date() })
    .where(eq(waMessages.id, id));
};

const markSkipped = async (id, reason) => {
  await db
    .update(waMessages)
    .set({ status: "skipped", error: String(reason || ""), updatedAt: new Date() })
    .where(eq(waMessages.id, id));
};

// Meta's delivery receipts can arrive out of order; a status only ever moves
// forward through this ranking, so "read" is never downgraded to "delivered".
const STATUS_RANK = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

/** Apply a Meta status webhook (sent/delivered/read/failed) to the outbound row. */
const applyStatusUpdate = async (wamid, status, error = "") => {
  if (!(status in STATUS_RANK)) return null;
  const [row] = await db.select().from(waMessages).where(eq(waMessages.wamid, wamid)).limit(1);
  if (!row) return null; // a status for a message we didn't send (or pre-dates us)
  if (STATUS_RANK[status] <= STATUS_RANK[row.status] && status !== "failed") return row;
  const [updated] = await db
    .update(waMessages)
    .set({ status, error: error ? String(error).slice(0, 2000) : row.error, updatedAt: new Date() })
    .where(eq(waMessages.id, row.id))
    .returning();
  return updated;
};

const findById = async (id) => {
  const [row] = await db.select().from(waMessages).where(eq(waMessages.id, id)).limit(1);
  return row || null;
};

/**
 * The service-window clock: when did this phone last message US? Free-form
 * replies are allowed within 24 h of that moment; only templates after.
 */
const lastInboundAt = async (waPhone) => {
  const [row] = await db
    .select({ createdAt: waMessages.createdAt })
    .from(waMessages)
    .where(and(eq(waMessages.waPhone, waPhone), eq(waMessages.direction, "inbound")))
    .orderBy(desc(waMessages.createdAt))
    .limit(1);
  return row ? row.createdAt : null;
};

/** The transcript for a session, oldest first — what support reads. */
const findBySession = async (sessionId) => {
  return db
    .select()
    .from(waMessages)
    .where(eq(waMessages.sessionId, sessionId))
    .orderBy(waMessages.createdAt);
};

module.exports = {
  recordInbound,
  markProcessed,
  createOutbound,
  markSent,
  markFailed,
  markSkipped,
  applyStatusUpdate,
  findById,
  lastInboundAt,
  findBySession,
};
