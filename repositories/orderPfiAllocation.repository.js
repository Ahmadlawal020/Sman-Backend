const { eq } = require("drizzle-orm");
const { db } = require("../config/db");
const { orderPfiAllocations } = require("../db/schema");

/**
 * Bulk-insert PFI allocations for an order. Called inside the placeOrder
 * transaction after all PFI stocks have been reserved.
 *
 * @param {Array<{pfiId: number, quantity: number}>} allocations
 * @param {number} orderId
 * @param {object} tx - database transaction
 */
const create = async (allocations, orderId, tx = db) => {
  if (!allocations.length) return [];
  const rows = allocations.map((a) => ({
    orderId,
    pfiId: a.pfiId,
    quantity: a.quantity,
  }));
  return tx.insert(orderPfiAllocations).values(rows).returning();
};

/**
 * All allocations for an ordered, oldest first. Used by cancel / expire to
 * release the correct amount from each PFI.
 */
const findByOrderId = async (orderId, tx = db) => {
  return tx
    .select()
    .from(orderPfiAllocations)
    .where(eq(orderPfiAllocations.orderId, orderId));
};

/**
 * Remove all allocations for an order. Called after stock has been released
 * during cancel / expire so the rows do not accumulate on terminal orders.
 */
const deleteByOrderId = async (orderId, tx = db) => {
  return tx
    .delete(orderPfiAllocations)
    .where(eq(orderPfiAllocations.orderId, orderId));
};

module.exports = {
  create,
  findByOrderId,
  deleteByOrderId,
};
