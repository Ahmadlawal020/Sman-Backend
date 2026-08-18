const { eq, and } = require("drizzle-orm");
const { db } = require("../config/db");
const { consumerPfimovement } = require("../db/schema");

/**
 * No live counterpart as a multi-row allocation table. consumer_order has a
 * single pfi_id FK (not a list), and consumer_pfimovement enforces at most
 * one RELEASE row per order (unique on action+order_id) — Django's model
 * only supports ONE PFI per order, not a split across several. The old
 * multi-allocation capability (an order drawing from several PFIs) has no
 * live equivalent; flagged in the Phase 4 gap report, not reimplemented.
 *
 * What DOES carry over — reading/undoing the single reservation an order
 * has — is already on pfi.repository.js (reserveStock/releaseStock/
 * getSoldQty), which is what actually writes consumer_pfimovement. This file
 * is kept only as a thin, order-scoped read to avoid touching every caller
 * of the old multi-row API at once.
 */

const create = async (allocations, orderId, tx = db) => {
  if (!allocations.length) return [];
  if (allocations.length > 1) {
    throw new Error(
      `orderPfiAllocation.create: order ${orderId} requests ${allocations.length} PFI allocations, but the live schema supports exactly one PFI per order (consumer_order.pfi_id, consumer_pfimovement unique on action+order_id). Multi-PFI orders have no live representation.`
    );
  }
  // The actual movement row is created by pfiRepo.reserveStock inside the
  // same transaction — this just confirms it happened for this order.
  const [row] = await tx
    .select()
    .from(consumerPfimovement)
    .where(and(eq(consumerPfimovement.orderId, orderId), eq(consumerPfimovement.pfiId, allocations[0].pfiId), eq(consumerPfimovement.action, "RELEASE")))
    .limit(1);
  return row ? [row] : [];
};

const findByOrderId = async (orderId, tx = db) => {
  return tx.select().from(consumerPfimovement).where(and(eq(consumerPfimovement.orderId, orderId), eq(consumerPfimovement.action, "RELEASE")));
};

const deleteByOrderId = async (orderId, tx = db) => {
  return tx.delete(consumerPfimovement).where(and(eq(consumerPfimovement.orderId, orderId), eq(consumerPfimovement.action, "RELEASE")));
};

module.exports = {
  create,
  findByOrderId,
  deleteByOrderId,
};
