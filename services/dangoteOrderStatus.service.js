const { eq } = require("drizzle-orm");
const { db } = require("../config/db");
const { dangoteOrderRequests } = require("../db/schema");
const { auditLogRepo } = require("../repositories");

/**
 * The Dangote order-request review-status machine — the ONE place
 * dangote_order_requests.status changes.
 *
 * Pipeline (the review axis only): Pending Review → Approved, with Rejected and
 * Cancelled as exits (Cancelled also allowed from Approved). Expired is an
 * automatic exit from Approved only (the expiry sweep, for approved orders
 * never funded in time). Payment is a separate, independently-guarded field,
 * not part of this machine. Every transition locks the row, writes the new
 * status and one audit_logs row in a single transaction, so two staff acting at
 * once can't both win and the audit trail never disagrees with the row.
 */
const TRANSITIONS = Object.freeze({
  "Pending Review": ["Approved", "Rejected", "Cancelled"],
  Approved: ["Cancelled", "Expired"], // cancel or auto-expire after approval
  Rejected: [],
  Cancelled: [],
  Expired: [],
});

const isLegal = (from, to) => (TRANSITIONS[from] || []).includes(to);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/**
 * Apply a review-status transition atomically, with an audit row.
 *
 * @param {number} id
 * @param {string} toStatus
 * @param {object} opts
 * @param {{type:"staff"|"customer"|"system", staffId?:number, customerId?:number}} opts.actor
 * @param {object} [opts.set]      extra columns to write alongside the status
 * @param {string} [opts.action]   audit label; defaults to dangote_order.<status>
 * @param {object} [opts.metadata] audit metadata
 * @param {(order)=>({status:number,message:string}|null)} [opts.guard] runs
 *   inside the row lock; return a refusal to reject (e.g. a paid order on cancel)
 * @param {object} [opts.tx]       join an existing transaction
 * @returns {{order: object, prevState: string}}
 */
async function transition(id, toStatus, opts = {}) {
  const run = async (tx) => {
    const [order] = await tx
      .select()
      .from(dangoteOrderRequests)
      .where(eq(dangoteOrderRequests.id, id))
      .for("update")
      .limit(1);

    if (!order) throw httpError(404, "Order request not found");

    if (opts.guard) {
      const refusal = opts.guard(order);
      if (refusal) throw httpError(refusal.status, refusal.message);
    }

    if (order.status === toStatus) throw httpError(409, `Order request is already ${toStatus}`);
    if (!isLegal(order.status, toStatus)) {
      throw httpError(409, `A Dangote order request cannot move from ${order.status} to ${toStatus}`);
    }

    const [updated] = await tx
      .update(dangoteOrderRequests)
      .set({ status: toStatus, ...(opts.set || {}), updatedAt: new Date() })
      .where(eq(dangoteOrderRequests.id, id))
      .returning();

    await auditLogRepo.record(
      {
        entityType: "dangote_order_request",
        entityId: id,
        action: opts.action || `dangote_order.${toStatus.toLowerCase().replace(/\s+/g, "_")}`,
        prevState: order.status,
        newState: toStatus,
        actor: opts.actor,
        metadata: opts.metadata ?? null,
      },
      tx
    );

    return { order: updated, prevState: order.status };
  };

  return opts.tx ? run(opts.tx) : db.transaction(run);
}

module.exports = { TRANSITIONS, isLegal, transition, httpError };
