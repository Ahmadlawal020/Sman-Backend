const { eq, and, gte, desc, count, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  dangoteDeliveryDocuments,
  dangoteDeliveryOrders,
} = require("../db/schema");

const findById = async (id) => {
  const [row] = await db
    .select()
    .from(dangoteDeliveryDocuments)
    .where(eq(dangoteDeliveryDocuments.id, id))
    .limit(1);
  return row || null;
};

const findByOrder = async (orderId) => {
  return db
    .select()
    .from(dangoteDeliveryDocuments)
    .where(eq(dangoteDeliveryDocuments.orderId, orderId))
    .orderBy(desc(dangoteDeliveryDocuments.createdAt));
};

const findLiveByOrderAndType = async (orderId, documentType) => {
  const [row] = await db
    .select()
    .from(dangoteDeliveryDocuments)
    .where(
      and(
        eq(dangoteDeliveryDocuments.orderId, orderId),
        eq(dangoteDeliveryDocuments.documentType, documentType)
      )
    )
    .limit(1);
  return row || null;
};

const create = async (data) => {
  const [row] = await db.insert(dangoteDeliveryDocuments).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const [row] = await db
    .update(dangoteDeliveryDocuments)
    .set(data)
    .where(eq(dangoteDeliveryDocuments.id, id))
    .returning();
  return row || null;
};

const deleteById = async (id) => {
  const [row] = await db
    .delete(dangoteDeliveryDocuments)
    .where(eq(dangoteDeliveryDocuments.id, id))
    .returning();
  return row || null;
};

// Reuse copies share the storage key of the original — an object may only be
// deleted when no row references it anymore.
const countByStorageKey = async (storageKey) => {
  const [{ total }] = await db
    .select({ total: count() })
    .from(dangoteDeliveryDocuments)
    .where(eq(dangoteDeliveryDocuments.storageKey, storageKey));
  return total;
};

// A customer's verified, unexpired documents for the same (normalized)
// company — the one-tap reuse offer in the wizard's company step.
const findReusable = async (customerId, companyNameNormalized) => {
  if (!companyNameNormalized) return [];
  return db
    .select({
      id: dangoteDeliveryDocuments.id,
      orderId: dangoteDeliveryDocuments.orderId,
      documentType: dangoteDeliveryDocuments.documentType,
      fileName: dangoteDeliveryDocuments.fileName,
      fileSize: dangoteDeliveryDocuments.fileSize,
      mimeType: dangoteDeliveryDocuments.mimeType,
      storageKey: dangoteDeliveryDocuments.storageKey,
      status: dangoteDeliveryDocuments.status,
      verifiedBy: dangoteDeliveryDocuments.verifiedBy,
      verifiedAt: dangoteDeliveryDocuments.verifiedAt,
      expiryDate: dangoteDeliveryDocuments.expiryDate,
      createdAt: dangoteDeliveryDocuments.createdAt,
    })
    .from(dangoteDeliveryDocuments)
    .innerJoin(
      dangoteDeliveryOrders,
      eq(dangoteDeliveryDocuments.orderId, dangoteDeliveryOrders.id)
    )
    .where(
      and(
        eq(dangoteDeliveryOrders.customerId, customerId),
        eq(dangoteDeliveryOrders.companyNameNormalized, companyNameNormalized),
        eq(dangoteDeliveryDocuments.status, "VERIFIED"),
        gte(dangoteDeliveryDocuments.expiryDate, sql`CURRENT_DATE`)
      )
    )
    .orderBy(desc(dangoteDeliveryDocuments.verifiedAt));
};

module.exports = {
  findById,
  findByOrder,
  findLiveByOrderAndType,
  create,
  update,
  deleteById,
  countByStorageKey,
  findReusable,
};
