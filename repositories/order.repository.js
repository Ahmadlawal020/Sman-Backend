const { eq, and, or, ilike, inArray, desc, asc, count, sql, gte, lte } = require("drizzle-orm");
const { db } = require("../config/db");
const { consumerOrder, consumerOrderproduct, consumerCustomer, consumerProduct, consumerPfi, consumerStates, customerCredits, walletHolds } = require("../db/schema");
const { generateOrderReference, parseOrderReference } = require("../utils/helpers");

/**
 * consumer_order is Django's real order table (74 columns) — see
 * docs/LIVE_DB_CUTOVER.md §3 and soroman_backend-2/consumer/models.py:1230
 * (the actual Order model — read directly, not inferred). Structural
 * differences from the old clean-room `orders` table this replaces:
 *
 *  - customerId is `user_id` (FK to consumer_customer despite the name —
 *    confirmed from the live FK constraint, not a guess).
 *  - No depotId column anywhere on the order. A depot isn't tracked
 *    directly — only pfiId, and a PFI's own locationId points at a STATE,
 *    not a depot. Order.state (below) is the order's own direct state_id FK,
 *    independent of the PFI's. Any caller filtering "orders for this depot"
 *    needs rethinking around state/PFI, not a depotId condition.
 *  - Line items live in consumer_orderproduct (order_id, product_id,
 *    quantity, price) — but every order in production has exactly one row
 *    there, exactly matching the order's own top-level quantity/total_price
 *    (verified against live data). create()/update() below write both,
 *    kept in sync, rather than switching the read path to a join.
 *  - deliveryType maps to `release_type` (delivery|pickup), not order_type
 *    (order_type is regular|in_house — a different, new axis).
 *  - idempotencyKey maps to `order_fingerprint` — same purpose (Django's own
 *    docstring: "SHA-256 fingerprint... checked within a short window to
 *    block accidental double-submits"), different column name.
 *  - No cancelledAt/cancelledBy/cancellationReason columns — Django expresses
 *    cancellation as status='canceled' (OrderStatus.CANCELED), not a separate
 *    timestamp. No expiredAt column either, and no "expired" status choice
 *    exists in OrderStatus at all — the expiry sweep (findStalePending) has
 *    nowhere on the live schema to record that an order lapsed. Flagged for
 *    the gap report, not invented here.
 *  - virtualAccountNumber/Bank/Name (customer's DVA) have no order-level
 *    equivalent — paidToAccountName/Number/BankName exist instead, but
 *    they're where WE tell the customer to pay, not the customer's own DVA.
 *  - customerBalance is computed (sman.customer_credits - active
 *    sman.wallet_holds), same as customer.repository.js's getBalance —
 *    see the BALANCE_SQL fragment below, inlined so findAll/findPayableOrders
 *    stay single queries instead of N+1ing a JS balance check per row.
 */

// Correlated subquery mirroring customer.repository.js's getBalance() math,
// for use inside a SELECT/WHERE against orders joined to consumer_customer.
const BALANCE_SQL = sql`(
  COALESCE((SELECT SUM(${customerCredits.amount}::numeric) FROM ${customerCredits} WHERE ${customerCredits.customerId} = ${consumerCustomer.id}), 0)
  -
  COALESCE((SELECT SUM(${walletHolds.amount}::numeric) FROM ${walletHolds} WHERE ${walletHolds.customerId} = ${consumerCustomer.id} AND ${walletHolds.status} = 'active'), 0)
)`;

const formatOrderRow = (row) => {
  if (!row) return null;
  const company = row.companyName || row.customerCompanyName || "";
  const ref = generateOrderReference(company, row.id);
  return { ...row, orderNumber: ref, reference: ref };
};

const findById = async (id, tx = db) => {
  const [row] = await tx.select().from(consumerOrder).where(eq(consumerOrder.id, id)).limit(1);
  return formatOrderRow(row);
};

/** Row-lock an order for the caller's transaction — see the old file's note on the gate flow; unchanged in intent. */
const lockById = async (id, tx = db) => {
  const [row] = await tx.select().from(consumerOrder).where(eq(consumerOrder.id, id)).for("update").limit(1);
  return formatOrderRow(row);
};

const findByIdempotencyKey = async (idempotencyKey, tx = db) => {
  const [row] = await tx.select().from(consumerOrder).where(eq(consumerOrder.orderFingerprint, idempotencyKey)).limit(1);
  return formatOrderRow(row);
};

/** No stored order_number live — every reference resolves through the id. */
const findByNumber = async (orderNumber) => {
  const normalized = String(orderNumber || "").trim().toUpperCase();
  if (!normalized) return null;
  const possibleId = parseOrderReference(normalized);
  if (!possibleId) return null;
  const [row] = await db.select().from(consumerOrder).where(eq(consumerOrder.id, possibleId)).limit(1);
  return formatOrderRow(row);
};

const FULL_ORDER_COLUMNS = {
  ...consumerOrder,
  customerName: consumerCustomer.firstName,
  customerLastName: consumerCustomer.lastName,
  customerEmail: consumerCustomer.email,
  customerPhone: consumerCustomer.phoneNumber,
  customerCompanyName: consumerCustomer.companyName,
  customerBalance: BALANCE_SQL,
  productName: consumerProduct.name,
  productUnit: consumerProduct.unit,
  pfiNumber: consumerPfi.pfiNumber,
  stateName: consumerStates.name,
};

const fullOrderQuery = (tx = db) =>
  tx
    .select(FULL_ORDER_COLUMNS)
    .from(consumerOrder)
    .leftJoin(consumerCustomer, eq(consumerOrder.userId, consumerCustomer.id))
    .leftJoin(consumerOrderproduct, eq(consumerOrderproduct.orderId, consumerOrder.id))
    .leftJoin(consumerProduct, eq(consumerOrderproduct.productId, consumerProduct.id))
    .leftJoin(consumerPfi, eq(consumerOrder.pfiId, consumerPfi.id))
    .leftJoin(consumerStates, eq(consumerOrder.stateId, consumerStates.id));

const findByIdFull = async (id, tx = db) => {
  const [row] = await fullOrderQuery(tx).where(eq(consumerOrder.id, id)).limit(1);
  return formatOrderRow(row);
};

const findByNumberFull = async (orderNumber, tx = db) => {
  const normalized = String(orderNumber || "").trim().toUpperCase();
  if (!normalized) return null;
  const possibleId = parseOrderReference(normalized);
  if (!possibleId) return null;
  const [row] = await fullOrderQuery(tx).where(eq(consumerOrder.id, possibleId)).limit(1);
  return formatOrderRow(row);
};

const findAll = async ({ search, status, customer, dateFrom, dateTo, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (search) {
    const possibleId = parseOrderReference(search);
    if (possibleId) conditions.push(eq(consumerOrder.id, possibleId));
  }
  if (status) conditions.push(eq(consumerOrder.status, status));
  if (customer) conditions.push(eq(consumerOrder.userId, Number(customer)));
  if (dateFrom) conditions.push(gte(consumerOrder.createdAt, new Date(dateFrom).toISOString()));
  if (dateTo) {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? `${dateTo}T23:59:59.999Z` : dateTo;
    conditions.push(lte(consumerOrder.createdAt, new Date(end).toISOString()));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: consumerOrder.id,
        quantity: consumerOrder.quantity,
        totalPrice: consumerOrder.totalPrice,
        status: consumerOrder.status,
        releaseStatus: consumerOrder.releaseStatus,
        releaseType: consumerOrder.releaseType,
        orderType: consumerOrder.orderType,
        pfiId: consumerOrder.pfiId,
        stateId: consumerOrder.stateId,
        createdAt: consumerOrder.createdAt,
        updatedAt: consumerOrder.updatedAt,
        customerName: consumerCustomer.firstName,
        customerLastName: consumerCustomer.lastName,
        customerCompanyName: consumerCustomer.companyName,
        customerPhone: consumerCustomer.phoneNumber,
        pfiNumber: consumerPfi.pfiNumber,
        stateName: consumerStates.name,
      })
      .from(consumerOrder)
      .leftJoin(consumerCustomer, eq(consumerOrder.userId, consumerCustomer.id))
      .leftJoin(consumerPfi, eq(consumerOrder.pfiId, consumerPfi.id))
      .leftJoin(consumerStates, eq(consumerOrder.stateId, consumerStates.id))
      .where(whereClause)
      .orderBy(desc(consumerOrder.createdAt))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(consumerOrder).where(whereClause),
  ]);

  return {
    orders: rows.map(formatOrderRow),
    pagination: { total: Number(total), page: pageNum, limit: limitNum, pages: Math.ceil(Number(total) / limitNum) },
  };
};

/**
 * Creates the order row AND its single consumer_orderproduct line item in
 * one call, keeping the two in sync per the note at the top of this file.
 * `data` takes the same product/quantity/price fields the old orders table
 * did; they're split between the two live tables internally.
 */
const create = async (data, tx = db) => {
  const { productId, quantity, price, ...orderData } = data;
  const totalPrice = orderData.totalPrice ?? (quantity != null && price != null ? Number(quantity) * Number(price) : undefined);

  const [row] = await tx
    .insert(consumerOrder)
    .values({ ...orderData, quantity, totalPrice: totalPrice != null ? String(totalPrice) : undefined })
    .returning();

  if (productId != null) {
    await tx.insert(consumerOrderproduct).values({
      orderId: row.id,
      productId,
      quantity,
      price: String(price ?? 0),
    });
  }

  return formatOrderRow(row);
};

const update = async (id, data, tx = db) => {
  const { productId, price, ...orderData } = data;
  const [row] = await tx.update(consumerOrder).set(orderData).where(eq(consumerOrder.id, id)).returning();

  if (productId != null || price != null) {
    const setData = {};
    if (productId != null) setData.productId = productId;
    if (price != null) setData.price = String(price);
    if (orderData.quantity != null) setData.quantity = orderData.quantity;
    await tx.update(consumerOrderproduct).set(setData).where(eq(consumerOrderproduct.orderId, id));
  }

  return formatOrderRow(row);
};

const findUnpaidByCustomer = async (customerId) => {
  const rows = await db
    .select()
    .from(consumerOrder)
    .where(and(eq(consumerOrder.userId, customerId), eq(consumerOrder.status, "pending")))
    .orderBy(asc(consumerOrder.createdAt));
  return rows.map(formatOrderRow);
};

const OPEN_STATUSES = ["pending", "paid", "released", "loaded"];

const findOpenByCustomer = async (customerId, limit = 9) => {
  const rows = await db
    .select({
      id: consumerOrder.id,
      status: consumerOrder.status,
      quantity: consumerOrder.quantity,
      totalPrice: consumerOrder.totalPrice,
      releaseType: consumerOrder.releaseType,
      paidToBankName: consumerOrder.paidToBankName,
      paidToAccountNumber: consumerOrder.paidToAccountNumber,
      productName: consumerProduct.name,
      stateName: consumerStates.name,
    })
    .from(consumerOrder)
    .leftJoin(consumerOrderproduct, eq(consumerOrderproduct.orderId, consumerOrder.id))
    .leftJoin(consumerProduct, eq(consumerOrderproduct.productId, consumerProduct.id))
    .leftJoin(consumerStates, eq(consumerOrder.stateId, consumerStates.id))
    .where(and(eq(consumerOrder.userId, customerId), inArray(consumerOrder.status, OPEN_STATUSES)))
    .orderBy(desc(consumerOrder.createdAt))
    .limit(limit);
  return rows.map(formatOrderRow);
};

const countByPfi = async (pfiId) => {
  const [{ total }] = await db.select({ total: count() }).from(consumerOrder).where(eq(consumerOrder.pfiId, pfiId));
  return Number(total);
};

/**
 * "Payable": unpaid pending order whose customer already holds enough
 * credit-ledger balance to cover it — same definition as before, computed
 * balance instead of a column.
 */
const findPayableOrders = async () => {
  const rows = await db
    .select({
      id: consumerOrder.id,
      userId: consumerOrder.userId,
      customerName: consumerCustomer.firstName,
      customerLastName: consumerCustomer.lastName,
      customerCompanyName: consumerCustomer.companyName,
      customerBalance: BALANCE_SQL,
      status: consumerOrder.status,
      quantity: consumerOrder.quantity,
      totalPrice: consumerOrder.totalPrice,
      releaseType: consumerOrder.releaseType,
      createdAt: consumerOrder.createdAt,
    })
    .from(consumerOrder)
    .innerJoin(consumerCustomer, eq(consumerOrder.userId, consumerCustomer.id))
    .where(and(eq(consumerOrder.status, "pending"), sql`${BALANCE_SQL} >= ${consumerOrder.totalPrice}::numeric`))
    .orderBy(asc(consumerOrder.createdAt));
  return rows.map(formatOrderRow);
};

/**
 * Pending orders created on or before `cutoff` — the expiry sweep's work
 * list. NOTE: consumer_order has no expiredAt column and OrderStatus has no
 * "expired" choice, so there is nowhere live to record that a sweep lapsed
 * one — this returns the candidates only. What the sweep DOES with them
 * needs a decision (see the Phase 4 gap report), not a silent status write
 * to a value Django doesn't define.
 */
const findStalePending = async (cutoff) => {
  return db
    .select({ id: consumerOrder.id, createdAt: consumerOrder.createdAt })
    .from(consumerOrder)
    .where(and(eq(consumerOrder.status, "pending"), lte(consumerOrder.createdAt, cutoff.toISOString ? cutoff.toISOString() : cutoff)))
    .orderBy(asc(consumerOrder.createdAt));
};

module.exports = {
  findById,
  lockById,
  findByNumber,
  findByIdempotencyKey,
  findByIdFull,
  findByNumberFull,
  findAll,
  create,
  update,
  findUnpaidByCustomer,
  findOpenByCustomer,
  countByPfi,
  findPayableOrders,
  findStalePending,
};
