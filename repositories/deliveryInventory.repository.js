const { eq, and, or, ilike, desc, count, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { administrationDeliveryinventory: deliveryInventory } = require("../db/schema");

const findById = async (id) => {
  const [row] = await db
    .select()
    .from(deliveryInventory)
    .where(eq(deliveryInventory.id, id))
    .limit(1);
  return row || null;
};

const findAll = async ({
  search,
  loading_status,
  truck_number,
  page = 1,
  limit = 500,
} = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (loading_status) {
    conditions.push(eq(deliveryInventory.loadingStatus, loading_status));
  }

  if (truck_number) {
    conditions.push(ilike(deliveryInventory.truckNumber, `%${truck_number}%`));
  }

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(deliveryInventory.truckNumber, pattern),
        ilike(deliveryInventory.pfiNumber, pattern),
        ilike(deliveryInventory.pfiProduct, pattern),
        ilike(deliveryInventory.customerName, pattern),
        ilike(deliveryInventory.depot, pattern),
        ilike(deliveryInventory.allocationCode, pattern),
        ilike(deliveryInventory.location, pattern),
        ilike(deliveryInventory.notes, pattern)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(deliveryInventory)
      .where(whereClause)
      .orderBy(desc(deliveryInventory.createdAt))
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: count() })
      .from(deliveryInventory)
      .where(whereClause),
  ]);

  return {
    loadings: rows,
    inventory: rows,
    pagination: {
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    },
  };
};

const create = async (data) => {
  const [row] = await db.insert(deliveryInventory).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const [row] = await db
    .update(deliveryInventory)
    // mode:'string' timestamp — a Date object makes the driver throw
    // ERR_INVALID_ARG_TYPE before the query even runs.
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(deliveryInventory.id, id))
    .returning();
  return row || null;
};

const deleteById = async (id) => {
  const [row] = await db
    .delete(deliveryInventory)
    .where(eq(deliveryInventory.id, id))
    .returning();
  return row || null;
};

module.exports = {
  findById,
  findAll,
  create,
  update,
  deleteById,
};
