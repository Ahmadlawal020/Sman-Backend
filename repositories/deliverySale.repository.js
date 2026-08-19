const { eq, and, or, ilike, desc, count, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { deliverySales, deliveryCustomers } = require("../db/schema");

const findById = async (id) => {
  const [row] = await db
    .select()
    .from(deliverySales)
    .where(eq(deliverySales.id, id))
    .limit(1);
  return row || null;
};

const findByPaystackReference = async (reference) => {
  const [row] = await db
    .select()
    .from(deliverySales)
    .where(eq(deliverySales.paystackReference, reference))
    .limit(1);
  return row || null;
};

const findPendingByCustomer = async (customerId) => {
  const [row] = await db
    .select()
    .from(deliverySales)
    .where(
      and(
        eq(deliverySales.customerId, customerId),
        sql`(${deliverySales.salesValue} - ${deliverySales.paymentAmount}) > 0`
      )
    )
    .orderBy(desc(deliverySales.createdAt))
    .limit(1);
  return row || null;
};

const findAll = async ({
  search,
  customer,
  truck_number,
  date_from,
  date_to,
  page = 1,
  limit = 500,
} = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (customer) {
    conditions.push(eq(deliverySales.customerId, customer));
  }

  if (truck_number) {
    conditions.push(ilike(deliverySales.truckNumber, `%${truck_number}%`));
  }

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(deliverySales.truckNumber, pattern),
        ilike(deliverySales.customerName, pattern),
        ilike(deliverySales.location, pattern),
        ilike(deliverySales.depotLoaded, pattern),
        ilike(deliverySales.payerName, pattern),
        ilike(deliverySales.remarks, pattern)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(deliverySales)
      .where(whereClause)
      .orderBy(desc(deliverySales.createdAt))
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: count() })
      .from(deliverySales)
      .where(whereClause),
  ]);

  return {
    sales: rows,
    pagination: {
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    },
  };
};

const create = async (data) => {
  const [row] = await db.insert(deliverySales).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const [row] = await db
    .update(deliverySales)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(deliverySales.id, id))
    .returning();
  return row || null;
};

const deleteById = async (id) => {
  const [row] = await db
    .delete(deliverySales)
    .where(eq(deliverySales.id, id))
    .returning();
  return row || null;
};

module.exports = {
  findById,
  findByPaystackReference,
  findPendingByCustomer,
  findAll,
  create,
  update,
  deleteById,
};
