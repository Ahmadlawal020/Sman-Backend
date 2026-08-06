const { eq, and, or, ilike, inArray, desc, asc, count, sql, gte, lte } = require("drizzle-orm");
const { db } = require("../config/db");
const { orders, customers, depots, products, pfis, orderTrucks } = require("../db/schema");
const { generateOrderReference } = require("../utils/helpers");

const formatOrderRow = (row) => {
  if (!row) return null;
  const company = row.companyName || row.customerCompanyName || "";
  const ref = generateOrderReference(company, row.id);
  return {
    ...row,
    orderNumber: ref,
    reference: ref,
  };
};

const findById = async (id, tx = db) => {
  const [row] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
  return formatOrderRow(row);
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
  return formatOrderRow(row);
};

/**
 * The idempotent-replay lookup: a caller retrying with the same key (e.g. a
 * redelivered WhatsApp webhook re-running CONFIRM) finds the order the first
 * attempt created.
 */
const findByIdempotencyKey = async (idempotencyKey, tx = db) => {
  const [row] = await tx
    .select()
    .from(orders)
    .where(eq(orders.idempotencyKey, idempotencyKey))
    .limit(1);
  return formatOrderRow(row);
};

const findByNumber = async (orderNumber) => {
  const normalized = String(orderNumber || "").trim().toUpperCase();
  if (!normalized) return null;

  const parts = normalized.split("/");
  const possibleId = parseInt(parts[parts.length - 1], 10);

  let row = null;
  if (!isNaN(possibleId) && String(possibleId) === parts[parts.length - 1]) {
    [row] = await db.select().from(orders).where(eq(orders.id, possibleId)).limit(1);
  }
  if (!row) {
    [row] = await db.select().from(orders).where(eq(orders.orderNumber, normalized)).limit(1);
  }
  return formatOrderRow(row);
};

// The joined columns a full order detail carries. Includes the per-stage
// lifecycle timestamps and cancellation reason so callers can render the
// order's own timeline without the public tracking endpoint — those columns
// (order.js) are the source of truth for tracking, reused here behind auth.
const FULL_ORDER_COLUMNS = {
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
  deliveryAddress: orders.deliveryAddress,
  companyName: orders.companyName,
  pfiId: orders.pfiId,
  virtualAccountNumber: orders.virtualAccountNumber,
  virtualAccountBank: orders.virtualAccountBank,
  virtualAccountName: orders.virtualAccountName,
  paymentStatus: orders.paymentStatus,
  status: orders.status,
  // Per-stage lifecycle stamps — one timestamp per stage, reached at most once.
  paymentConfirmedAt: orders.paymentConfirmedAt,
  releasedAt: orders.releasedAt,
  loadingStartedAt: orders.loadingStartedAt,
  completedAt: orders.completedAt,
  cancelledAt: orders.cancelledAt,
  cancellationReason: orders.cancellationReason,
  expiredAt: orders.expiredAt,
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
};

const fullOrderQuery = (tx = db) =>
  tx
    .select(FULL_ORDER_COLUMNS)
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(depots, eq(orders.depotId, depots.id))
    .leftJoin(products, eq(orders.productId, products.id))
    .leftJoin(pfis, eq(orders.pfiId, pfis.id));

const findByIdFull = async (id, tx = db) => {
  const [row] = await fullOrderQuery(tx).where(eq(orders.id, id)).limit(1);
  return formatOrderRow(row);
};

/**
 * The same full detail keyed by order number rather than numeric id. Serves
 * the customer portal's by-reference lookup: the reference (order number) is
 * the id every screen and SMS shows, so the customer can open an order by the
 * value they hold without first resolving it to a database id. Normalised the
 * same way tracking does — trimmed and upper-cased.
 */
const findByNumberFull = async (orderNumber, tx = db) => {
  const normalized = String(orderNumber || "").trim().toUpperCase();
  if (!normalized) return null;

  const parts = normalized.split("/");
  const possibleId = parseInt(parts[parts.length - 1], 10);

  let row = null;
  if (!isNaN(possibleId) && String(possibleId) === parts[parts.length - 1]) {
    [row] = await fullOrderQuery(tx).where(eq(orders.id, possibleId)).limit(1);
  }
  if (!row) {
    [row] = await fullOrderQuery(tx)
      .where(eq(orders.orderNumber, normalized))
      .limit(1);
  }
  return formatOrderRow(row);
};

/**
 * The truck loads on an order, oldest ordinal first. Carries the plate, the
 * per-load quantity, movement status and gate stamps, plus driver contact —
 * safe here because this is the order owner's own view behind auth (unlike the
 * public tracking feed, which withholds driver details).
 */
const findTrucksByOrderId = async (orderId, tx = db) => {
  return tx
    .select({
      truckIndex: orderTrucks.truckIndex,
      truckNumber: orderTrucks.truckNumber,
      quantity: orderTrucks.quantity,
      status: orderTrucks.status,
      driverName: orderTrucks.driverName,
      driverPhone: orderTrucks.driverPhone,
      securityEnteredAt: orderTrucks.securityEnteredAt,
      loadedAt: orderTrucks.loadedAt,
      securityExitedAt: orderTrucks.securityExitedAt,
    })
    .from(orderTrucks)
    .where(eq(orderTrucks.orderId, orderId))
    .orderBy(asc(orderTrucks.truckIndex));
};

const findAll = async ({
  search,
  status,
  customer,
  depot,
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
    const parts = search.trim().split("/");
    const possibleId = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(possibleId) && String(possibleId) === parts[parts.length - 1]) {
      conditions.push(or(ilike(orders.orderNumber, `%${search}%`), eq(orders.id, possibleId)));
    } else {
      conditions.push(ilike(orders.orderNumber, `%${search}%`));
    }
  }

  if (status) {
    conditions.push(eq(orders.status, status));
  }

  if (customer) {
    conditions.push(eq(orders.customerId, Number(customer)));
  }

  if (depot) {
    conditions.push(eq(orders.depotId, Number(depot)));
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
        deliveryAddress: orders.deliveryAddress,
        companyName: orders.companyName,
        pfiId: orders.pfiId,
        virtualAccountNumber: orders.virtualAccountNumber,
        virtualAccountBank: orders.virtualAccountBank,
        virtualAccountName: orders.virtualAccountName,
        paymentStatus: orders.paymentStatus,
        status: orders.status,
        expiredAt: orders.expiredAt,
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
        productCategory: products.category,
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
    orders: rows.map(formatOrderRow),
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
    },
  };
};

const create = async (data, tx = db) => {
  const [row] = await tx.insert(orders).values(data).returning();
  return formatOrderRow(row);
};

const update = async (id, data, tx = db) => {
  const [row] = await tx
    .update(orders)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(orders.id, id))
    .returning();
  return formatOrderRow(row);
};

const findUnpaidByCustomer = async (customerId) => {
  // Pending only: a cancelled order must never be auto-paid, and a completed
  // one can't legally be unpaid.
  const rows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.customerId, customerId),
        eq(orders.paymentStatus, "Unpaid"),
        eq(orders.status, "Pending")
      )
    )
    .orderBy(asc(orders.createdAt));
  return rows.map(formatOrderRow);
};

// Everything before Completed/Cancelled — what a customer can still track.
const OPEN_STATUSES = ["Pending", "Paid", "Released", "Loading"];

/**
 * The customer's in-flight orders with the display names joined in, newest
 * first. Capped for the WhatsApp list (9 rows + reserve); the portal is the
 * home of unbounded history.
 */
const findOpenByCustomer = async (customerId, limit = 9) => {
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      companyName: orders.companyName,
      customerCompanyName: customers.companyName,
      status: orders.status,
      quantity: orders.quantity,
      totalAmount: orders.totalAmount,
      deliveryType: orders.deliveryType,
      virtualAccountBank: orders.virtualAccountBank,
      virtualAccountNumber: orders.virtualAccountNumber,
      productName: products.name,
      depotName: depots.name,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(depots, eq(orders.depotId, depots.id))
    .leftJoin(products, eq(orders.productId, products.id))
    .where(and(eq(orders.customerId, customerId), inArray(orders.status, OPEN_STATUSES)))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
  return rows.map(formatOrderRow);
};

const countByPfi = async (pfiId) => {
  const [{ total }] = await db
    .select({ total: count() })
    .from(orders)
    .where(eq(orders.pfiId, pfiId));
  return total;
};

const findPayableOrders = async () => {
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerId: orders.customerId,
      customerName: customers.name,
      companyName: orders.companyName,
      customerCompanyName: customers.companyName,
      customerBalance: customers.balance,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      quantity: orders.quantity,
      totalAmount: orders.totalAmount,
      deliveryType: orders.deliveryType,
      createdAt: orders.createdAt,
      depotName: depots.name,
      productName: products.name,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(depots, eq(orders.depotId, depots.id))
    .leftJoin(products, eq(orders.productId, products.id))
    .where(
      and(
        eq(orders.paymentStatus, "Unpaid"),
        eq(orders.status, "Pending"),
        sql`${customers.balance} >= ${orders.totalAmount}`
      )
    )
    .orderBy(asc(orders.createdAt));
  return rows.map(formatOrderRow);
};

/**
 * Pending, unpaid orders created on or before `cutoff` — the expiry sweep's
 * work list. Oldest first, so the log reads in the order they lapsed.
 */
const findStalePending = async (cutoff) => {
  return db
    .select({ id: orders.id, orderNumber: orders.orderNumber, createdAt: orders.createdAt })
    .from(orders)
    .where(
      and(
        eq(orders.status, "Pending"),
        eq(orders.paymentStatus, "Unpaid"),
        lte(orders.createdAt, cutoff)
      )
    )
    .orderBy(asc(orders.createdAt));
};

module.exports = {
  findById,
  lockById,
  findByNumber,
  findByIdempotencyKey,
  findByIdFull,
  findByNumberFull,
  findTrucksByOrderId,
  findAll,
  create,
  update,
  findUnpaidByCustomer,
  findOpenByCustomer,
  countByPfi,
  findPayableOrders,
  findStalePending,
};
