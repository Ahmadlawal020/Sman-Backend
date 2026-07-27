const { eq } = require("drizzle-orm");
const { db } = require("../config/db");
const { orders } = require("../db/schema");
const { auditLogRepo } = require("../repositories");

/**
 * The order state machine — the ONE place order.status changes.
 *
 * Pipeline: Pending → Paid → Released → Loading → Completed, with Cancelled as
 * an exit up to and including Released. Every transition writes the new status,
 * its stage columns and one audit_logs row inside a single transaction, and
 * takes a row lock so two concurrent transitions on the same order cannot both
 * win — the loser re-reads the new status and finds its move no longer legal.
 */

// from → [legal to]. Loading/Completed are driven by truck gate actions, which
// call transition() when the first/last truck moves.
const TRANSITIONS = Object.freeze({
  Pending: ["Paid", "Cancelled"],
  Paid: ["Released", "Cancelled"],
  Released: ["Loading", "Cancelled"], // cancel allowed THROUGH Released
  Loading: ["Completed"], // no cancel once a truck has gated in
  Completed: [],
  Cancelled: [],
});

const isLegal = (from, to) => (TRANSITIONS[from] || []).includes(to);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/**
 * Apply a status transition atomically.
 *
 * @param {number} orderId
 * @param {string} toStatus
 * @param {object} opts
 * @param {object} opts.actor        { type, staffId?, customerId? } — for the audit row
 * @param {object} [opts.set]        stage columns to write (released_at/by, …)
 * @param {string} [opts.action]     audit action label; defaults to order.<status>
 * @param {object} [opts.metadata]   audit metadata (reason, amounts, truck ids)
 * @param {string} [opts.ipAddress]
 * @param {string} [opts.userAgent]
 * @param {object} [opts.tx]         run inside an existing transaction (truck flow)
 * @returns {object} the updated order row
 */
async function transition(orderId, toStatus, opts = {}) {
  const run = async (tx) => {
    // Lock the row: the guard that makes concurrent transitions single-winner.
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update")
      .limit(1);

    if (!order) throw httpError(404, "Order not found");

    if (order.status === toStatus) {
      throw httpError(409, `Order is already ${toStatus}`);
    }
    if (!isLegal(order.status, toStatus)) {
      throw httpError(409, `An order cannot move from ${order.status} to ${toStatus}`);
    }

    const [updated] = await tx
      .update(orders)
      .set({ status: toStatus, ...(opts.set || {}), updatedAt: new Date() })
      .where(eq(orders.id, orderId))
      .returning();

    await auditLogRepo.record(
      {
        entityType: "order",
        entityId: orderId,
        action: opts.action || `order.${toStatus.toLowerCase()}`,
        prevState: order.status,
        newState: toStatus,
        actor: opts.actor,
        metadata: opts.metadata ?? null,
        ipAddress: opts.ipAddress ?? null,
        userAgent: opts.userAgent ?? null,
      },
      tx
    );

    return updated;
  };

  // Join a caller's transaction (the truck flow does several things at once),
  // or open a fresh one.
  return opts.tx ? run(opts.tx) : db.transaction(run);
}

module.exports = { TRANSITIONS, isLegal, transition, httpError };
