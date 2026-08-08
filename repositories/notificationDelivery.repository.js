const { eq, and, desc, count, sql, lt, gte } = require("drizzle-orm");
const { db } = require("../config/db");
const { notificationDeliveries } = require("../db/schema");

/**
 * The outbound audit trail. Writes here must never break a send — this is
 * bookkeeping about a side effect, and losing the bookkeeping is strictly
 * better than losing the notification. Every writer is therefore wrapped so a
 * logging failure is reported and swallowed.
 */

const safe = async (label, fn) => {
  try {
    return await fn();
  } catch (err) {
    console.error(`[notify] delivery log ${label} failed:`, err.message);
    return null;
  }
};

/** Open a delivery record before the provider is called. */
const start = async ({
  notificationId = null,
  principal = null,
  type,
  channel,
  destination = "",
}) => {
  return safe("start", async () => {
    const [row] = await db
      .insert(notificationDeliveries)
      .values({
        notificationId,
        principalType: principal?.type || null,
        staffId: principal?.type === "staff" ? Number(principal.id) : null,
        customerId: principal?.type === "customer" ? Number(principal.id) : null,
        type,
        channel,
        destination: String(destination || "").slice(0, 255),
        status: "pending",
        attempts: 0,
      })
      .returning();
    return row;
  });
};

const markSent = async (id, { providerMessageId = "", attempts = 1 } = {}) => {
  if (!id) return null;
  return safe("markSent", async () => {
    const [row] = await db
      .update(notificationDeliveries)
      .set({
        status: "sent",
        providerMessageId: String(providerMessageId || "").slice(0, 255),
        attempts,
        error: null,
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(notificationDeliveries.id, id))
      .returning();
    return row;
  });
};

const markFailed = async (id, error, { attempts = 1 } = {}) => {
  if (!id) return null;
  return safe("markFailed", async () => {
    const [row] = await db
      .update(notificationDeliveries)
      .set({
        status: "failed",
        attempts,
        // Provider errors can carry an entire HTML error page; a truncated
        // message is diagnosable, an unbounded one bloats every row.
        error: String(error || "").slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(notificationDeliveries.id, id))
      .returning();
    return row;
  });
};

/**
 * Terminal, non-error outcomes. `skipped` = nothing to send to (no email on
 * file); `suppressed` = the recipient's own preferences said no. Recorded
 * rather than dropped, so "why didn't they get it?" always has an answer.
 */
const markResolved = async (id, status, reason = "") => {
  if (!id) return null;
  return safe("markResolved", async () => {
    const [row] = await db
      .update(notificationDeliveries)
      .set({ status, error: reason ? String(reason).slice(0, 2000) : null, updatedAt: new Date() })
      .where(eq(notificationDeliveries.id, id))
      .returning();
    return row;
  });
};

/** One-shot record for an outcome already known — no provider call was made. */
const record = async (fields, status, reason = "") => {
  return safe("record", async () => {
    const opened = await start(fields);
    if (!opened) return null;
    return markResolved(opened.id, status, reason);
  });
};

/** Support view: every channel attempt behind one inbox row. */
const findForNotification = async (notificationId) => {
  return db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.notificationId, Number(notificationId)))
    .orderBy(desc(notificationDeliveries.createdAt));
};

/** Admin log screen, newest first. */
const findAll = async ({ channel, status, type, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (channel && channel !== "all") conditions.push(eq(notificationDeliveries.channel, channel));
  if (status && status !== "all") conditions.push(eq(notificationDeliveries.status, status));
  if (type) conditions.push(eq(notificationDeliveries.type, type));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(notificationDeliveries)
      .where(whereClause)
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(notificationDeliveries).where(whereClause),
  ]);

  return {
    rows,
    pagination: {
      total: Number(total),
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(Number(total) / limitNum) || 1,
    },
  };
};

/**
 * Channel health over a window — the number that tells an operator Termii has
 * been swallowing messages since lunchtime.
 */
const statsSince = async (since) => {
  const rows = await db
    .select({
      channel: notificationDeliveries.channel,
      status: notificationDeliveries.status,
      total: count(),
    })
    .from(notificationDeliveries)
    .where(gte(notificationDeliveries.createdAt, since))
    .groupBy(notificationDeliveries.channel, notificationDeliveries.status);

  const byChannel = {};
  for (const row of rows) {
    byChannel[row.channel] ||= { sent: 0, failed: 0, skipped: 0, suppressed: 0, pending: 0, delivered: 0 };
    byChannel[row.channel][row.status] = Number(row.total);
  }

  for (const channel of Object.keys(byChannel)) {
    const c = byChannel[channel];
    const attempted = c.sent + c.delivered + c.failed;
    // Only real attempts count: a suppressed send is an opt-out working, not
    // a delivery failure, and folding it in would hide genuine outages.
    c.attempted = attempted;
    c.successRate = attempted > 0 ? Math.round(((c.sent + c.delivered) / attempted) * 1000) / 10 : null;
  }

  return byChannel;
};

const purgeOlderThan = async (cutoff) => {
  const rows = await db
    .delete(notificationDeliveries)
    .where(lt(notificationDeliveries.createdAt, cutoff))
    .returning({ id: notificationDeliveries.id });
  return rows.length;
};

module.exports = {
  start,
  markSent,
  markFailed,
  markResolved,
  record,
  findForNotification,
  findAll,
  statsSince,
  purgeOlderThan,
};
