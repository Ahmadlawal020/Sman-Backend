const { eq } = require("drizzle-orm");
const { db } = require("../../config/db");
const { dangoteDeliveryOrders, dangoteDeliveryEvents } = require("../../db/schema");
const { emitEvent } = require("../events");

// The only legal way to move a Dangote delivery order between statuses.
// Mirrors the frontend machine (mock-api.ts TRANSITIONS): controllers call
// transition(); nothing else writes the status column. Each move stamps its
// stage timestamp, appends a timeline event, and announces on the event bus
// (audit + notification consumers pick it up from there).

const TRANSITIONS = {
  DRAFT: ["DOCUMENTS_SUBMITTED", "CANCELLED"],
  DOCUMENTS_SUBMITTED: ["AGREEMENT_ACCEPTED", "CANCELLED"],
  AGREEMENT_ACCEPTED: ["UNDER_REVIEW", "CANCELLED"],
  // CANCELLED here deviates from the mock's map on purpose: the frontend's
  // CANCELLABLE_STATUSES includes UNDER_REVIEW but its map forgot the edge
  // (cancel would throw). The backend follows the declared cancellable set.
  UNDER_REVIEW: ["APPROVED", "REJECTED", "NEEDS_CHANGES", "CANCELLED"],
  NEEDS_CHANGES: ["DRAFT", "CANCELLED"],
  APPROVED: ["PAYMENT_PENDING", "CANCELLED", "DOCUMENTS_EXPIRED"],
  PAYMENT_PENDING: ["PAID", "CANCELLED"],
  PAID: ["SCHEDULED"],
  SCHEDULED: ["DISPATCHED", "DOCUMENTS_EXPIRED"],
  DISPATCHED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
  DOCUMENTS_EXPIRED: [],
};

// Stage stamp written exactly once, on entry to the status.
const STAGE_STAMPS = {
  UNDER_REVIEW: "submittedAt",
  APPROVED: "approvedAt",
  PAID: "paidAt",
  SCHEDULED: "scheduledAt",
  DISPATCHED: "dispatchedAt",
  COMPLETED: "completedAt",
  CANCELLED: "cancelledAt",
};

class TransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = "TransitionError";
    this.statusCode = 409;
  }
}

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

/**
 * Move an order to `next`, or throw TransitionError (409) if the move is
 * illegal. Extra column writes that belong to the same moment (quote fields,
 * payment reference) ride along via `set`.
 */
const transition = async (order, next, { actorType = "system", actorId = null, note = "", set = {} } = {}) => {
  if (!canTransition(order.status, next)) {
    throw new TransitionError(`Cannot move a ${order.status} Dangote delivery order to ${next}`);
  }

  const updateData = { ...set, status: next, updatedAt: new Date() };
  const stamp = STAGE_STAMPS[next];
  if (stamp && !order[stamp]) {
    updateData[stamp] = new Date();
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(dangoteDeliveryOrders)
      .set(updateData)
      .where(eq(dangoteDeliveryOrders.id, order.id))
      .returning();

    await tx.insert(dangoteDeliveryEvents).values({
      orderId: order.id,
      event: next,
      note: note || "",
      actorType,
      actorId,
    });

    return row;
  });

  emitEvent("dangote_delivery.status_changed", {
    orderId: order.id,
    requestNumber: updated.requestNumber,
    customerId: updated.customerId,
    from: order.status,
    to: next,
    note: note || "",
    actorType,
    actorId,
  });

  return updated;
};

/**
 * Record a non-status action (document verified, note added) on the timeline
 * without touching the status column.
 */
const recordEvent = async (orderId, event, { actorType = "system", actorId = null, note = "" } = {}) => {
  await db.insert(dangoteDeliveryEvents).values({
    orderId,
    event,
    note: note || "",
    actorType,
    actorId,
  });
};

module.exports = { TRANSITIONS, STAGE_STAMPS, TransitionError, canTransition, transition, recordEvent };
