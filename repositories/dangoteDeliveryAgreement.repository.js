const { eq } = require("drizzle-orm");
const { db } = require("../config/db");
const { dangoteDeliveryAgreements } = require("../db/schema");

const findByOrder = async (orderId) => {
  const [row] = await db
    .select()
    .from(dangoteDeliveryAgreements)
    .where(eq(dangoteDeliveryAgreements.orderId, orderId))
    .limit(1);
  return row || null;
};

const create = async (data) => {
  const [row] = await db.insert(dangoteDeliveryAgreements).values(data).returning();
  return row;
};

// One agreement per order (unique index); regeneration replaces it.
const deleteByOrder = async (orderId) => {
  await db
    .delete(dangoteDeliveryAgreements)
    .where(eq(dangoteDeliveryAgreements.orderId, orderId));
};

module.exports = { findByOrder, create, deleteByOrder };
