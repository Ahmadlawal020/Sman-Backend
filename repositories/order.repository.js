const { eq, and, or, ilike, desc, asc, count, sql, gte, lte } = require("drizzle-orm");
const { db } = require("../config/db");
const { orders, customers, depots, products, pfis } = require("../db/schema");

const findById = async (id, tx = db) => {
  const [row] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
  return row || null;
};

/**
 * Row-lock an order for the caller's transaction. The gate flow uses this to
 * serialise concurrent truck actions on one order: two trucks gating in (or
 * out) at the same moment each take this lock in turn, so exactly one observes
 * the "first in" / "last out" edge and drives the Released→Loading / Loading→
 * Completed transition — the other sees the already-moved status and skips it.
 */
const lockById = async (id, tx = db) => {
  const [row] = await tx.select().from(orders).where(eq(orders.id, id)).for("update").limit(1);
  return row || null;
};

const findByNumber = async (orderNumber) => {
  const [row] = await db
    .select()
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);
  return row || null;
};

const findByIdFull = async (id, tx = db) => {
  const [row] = await tx
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerId: orders.customerId,
      state: orders.state,
      depotId: orders.depotId,
      productId: orders.productId,
      quantity: orders.quantity,
      price: orders.price,
      totalAmount: orders.totalAmount,
      deliveryType: orders.deliveryType,
      pfiId: orders.pfiId,
      virtualAccountNumber: orders.virtualAccountNumber,
      virtualAccountBank: orders.virtualAccountBank,
      virtualAccountName: orders.virtualAccountName,
      paymentStatus: orders.paymentStatus,
      status: orders.status,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      // Customer fields
      customerName: customers.name,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      customerCompanyName: customers.companyName,
      customerBalance: customers.balance,
      customerVirtualAccountName: customers.virtualAccountName,
      // Depot fields
      depotName: depots.name,
      depotCode: depots.code,
      depotAddress: depots.address,
      // Product fields
      productName: products.name,
      productSku: products.sku,
      productUnit: products.unit,
      productCategory: products.category,
      // PFI fields
      pfiNumber: pfis.pfiNumber,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(depots, eq(orders.depotId, depots.id))
    .leftJoin(products, eq(orders.productId, products.id))
    .leftJoin(pfis, eq(orders.pfiId, pfis.id))
    .where(eq(orders.id, id))
    .limit(1);
  return row || null;
};

const findAll = async ({
  search,
  status,
  customer,
  dateFrom,
  dateTo,
  page = 1,
  limit = 50,
} = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (search) {
    conditions.push(ilike(orders.orderNumber, `%${search}%`));
  }

  if (status) {
    conditions.push(eq(orders.status, status));
  }

  if (customer) {
    conditions.push(eq(orders.customerId, customer));
  }

  if (dateFrom) {
    conditions.push(gte(orders.createdAt, new Date(dateFrom)));
  }

  if (dateTo) {
    conditions.push(lte(orders.createdAt, new Date(dateTo)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerId: orders.customerId,
        state: orders.state,
        depotId: orders.depotId,
        productId: orders.productId,
        quantity: orders.quantity,
        price: orders.price,
        totalAmount: orders.totalAmount,
        deliveryType: orders.deliveryType,
        pfiId: orders.pfiId,
        virtualAccountNumber: orders.virtualAccountNumber,
        virtualAccountBank: orders.virtualAccountBank,
        virtualAccountName: orders.virtualAccountName,
        paymentStatus: orders.paymentStatus,
        status: orders.status,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        customerName: customers.name,
        customerCompanyName: customers.companyName,
        customerEmail: customers.email,
        customerPhone: customers.phone,
        depotName: depots.name,
        depotCode: depots.code,
        productName: products.name,
        productSku: products.sku,
        productUnit: products.unit,
        pfiNumber: pfis.pfiNumber,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(depots, eq(orders.depotId, depots.id))
      .leftJoin(products, eq(orders.productId, products.id))
      .leftJoin(pfis, eq(orders.pfiId, pfis.id))
      .where(whereClause)
      .orderBy(desc(orders.createdAt))
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: count() })
      .from(orders)
      .where(whereClause),
  ]);

  return {
    orders: rows,
    pagination: {
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    },
  };
};

const create = async (data, tx = db) => {
  const [row] = await tx.insert(orders).values(data).returning();
  return row;
};

const update = async (id, data, tx = db) => {
  const [row] = await tx
    .update(orders)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(orders.id, id))
    .returning();
  return row || null;
};

const findUnpaidByCustomer = async (customerId) => {
  return db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.customerId, customerId),
        eq(orders.paymentStatus, "Unpaid")
      )
    )
    .orderBy(asc(orders.createdAt));
};

const countByPfi = async (pfiId) => {
  const [{ total }] = await db
    .select({ total: count() })
    .from(orders)
    .where(eq(orders.pfiId, pfiId));
  return total;
};

module.exports = {
  findById,
  lockById,
  findByNumber,
  findByIdFull,
  findAll,
  create,
  update,
  findUnpaidByCustomer,
  countByPfi,
};
