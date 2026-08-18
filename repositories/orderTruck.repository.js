const { eq, and, asc, count, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { consumerTruckallocation } = require("../db/schema");

/**
 * consumer_truckallocation is Django's real per-truck-load table — see
 * soroman_backend-2/consumer/models.py:1732 ("a single truck load within a
 * bulk order... created at order time"), the direct equivalent of the old
 * `order_trucks` table. Column differences:
 *
 *  - truckIndex doesn't exist — truckNumber IS the ordinal (1, 2, 3…) per
 *    the unique constraint on (truck_number, order_product_id).
 *  - No status/securityEnteredAt/loadedAt/securityExitedAt — gate tracking
 *    lives on consumer_truckticket instead (ticket.repository.js), which is
 *    a separate row created later via Django's generate-tickets endpoint,
 *    not at order/allocation time. ticketStatus here is the allocation's own
 *    lifecycle (pending/ticketed/…), not a gate state.
 *  - Keyed to order_product_id, not just order_id (matches
 *    consumer_orderproduct's 1:1-with-order shape noted in
 *    order.repository.js).
 */

const create = async (data, tx = db) => {
  const [row] = await tx.insert(consumerTruckallocation).values(data).returning();
  return row;
};

const findById = async (id, tx = db) => {
  const [row] = await tx.select().from(consumerTruckallocation).where(eq(consumerTruckallocation.id, id)).limit(1);
  return row || null;
};

const findByOrder = async (orderId, tx = db) => {
  return tx
    .select()
    .from(consumerTruckallocation)
    .where(eq(consumerTruckallocation.orderId, orderId))
    .orderBy(asc(consumerTruckallocation.truckNumber));
};

const update = async (id, data, tx = db) => {
  const [row] = await tx
    .update(consumerTruckallocation)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(consumerTruckallocation.id, id))
    .returning();
  return row || null;
};

const countByOrderAndStatus = async (orderId, ticketStatus, tx = db) => {
  const [row] = await tx
    .select({ n: count() })
    .from(consumerTruckallocation)
    .where(and(eq(consumerTruckallocation.orderId, orderId), eq(consumerTruckallocation.ticketStatus, ticketStatus)));
  return Number(row?.n || 0);
};

const countByOrder = async (orderId, tx = db) => {
  const [row] = await tx.select({ n: count() }).from(consumerTruckallocation).where(eq(consumerTruckallocation.orderId, orderId));
  return Number(row?.n || 0);
};

const deleteByOrder = async (orderId, tx = db) => {
  await tx.delete(consumerTruckallocation).where(eq(consumerTruckallocation.orderId, orderId));
};

module.exports = {
  create,
  findById,
  findByOrder,
  update,
  deleteByOrder,
  countByOrderAndStatus,
  countByOrder,
};
