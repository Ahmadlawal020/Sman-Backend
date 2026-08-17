const { eq, and, or, ilike, inArray, desc, asc, count, sql, gte, lte } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  orders, customers, depots, products, pfis, orderTrucks,
  deposits, orderDepositAllocations, staff,
} = require("../db/schema");
const { generateOrderReference, parseOrderReference } = require("../utils/helpers");
const { scopeCondition } = require("../lib/scopeFilter");

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

  // Resolves "SO600" and the legacy "SO/600" alike — see parseOrderReference.
  const possibleId = parseOrderReference(normalized);

  let row = null;
  if (possibleId) {
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

  const possibleId = parseOrderReference(normalized);

  let row = null;
  if (possibleId) {
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
  /** Same rule findPayableOrders uses — see the condition below. */
  payable,
  /** The authenticated caller, for location/PFI scoping. Omitted = unfiltered (internal callers). */
  scopeUser,
  page = 1,
  limit = 50,
} = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  const scope = scopeCondition(scopeUser, { depotColumn: orders.depotId, pfiColumn: orders.pfiId });
  if (scope) conditions.push(scope);

  if (search) {
    // A reference-shaped search ("SO600", or the legacy "SO/600") also matches
    // on id, since the reference is computed and not a column to search.
    const possibleId = parseOrderReference(search);
    if (possibleId) {
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

  // "Payable" is not a status — it is an unpaid pending order whose customer
  // already holds enough wallet balance to cover it. Expressed here so the
  // main list can show them alongside everything else rather than needing a
  // separate page.
  if (payable === true || payable === "true" || payable === "1") {
    conditions.push(eq(orders.paymentStatus, "Unpaid"));
    conditions.push(eq(orders.status, "Pending"));
    // A correlated subquery rather than customers.balance directly: the
    // count query alongside this one selects from orders with no join, so a
    // bare column reference breaks it.
    conditions.push(
      sql`${orders.totalAmount} <= (SELECT c.balance FROM customers c WHERE c.id = ${orders.customerId})`
    );
  }

  if (dateTo) {
    // Inclusive of the whole day: a bare "2026-08-06" parses as that date's
    // UTC midnight, so comparing createdAt against it as-is excluded every
    // order placed later that same day — a caller asking for "today" got
    // nothing. Built as an explicit UTC string, same as dateFrom above, so
    // the two boundaries don't drift against each other by the server's
    // local timezone.
    const end = /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? `${dateTo}T23:59:59.999Z` : dateTo;
    conditions.push(lte(orders.createdAt, new Date(end)));
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
        customerBalance: customers.balance,
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

/**
 * Every confirmed payment, order by order, with exactly where the money for
 * each one is understood to have come from.
 *
 * `funding` is built from a second, batched query rather than a join on the
 * main select — a LEFT JOIN against order_deposit_allocations would multiply
 * order rows by however many deposits funded them, breaking pagination counts.
 * An order with zero funding rows genuinely predates the allocation ledger
 * (see wallet.service.js) — that's surfaced as fundingTracked: false, not an
 * error.
 */
const findFinanceReport = async ({
  search,
  paymentStatus = "Paid",
  dateFrom,
  dateTo,
  scopeUser,
  page = 1,
  limit = 50,
} = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const scope = scopeCondition(scopeUser, { depotColumn: orders.depotId, pfiColumn: orders.pfiId });
  if (scope) conditions.push(scope);
  if (paymentStatus && paymentStatus !== "all") {
    conditions.push(eq(orders.paymentStatus, paymentStatus));
  }
  if (search) {
    const possibleId = parseOrderReference(search);
    const term = `%${search}%`;
    conditions.push(
      possibleId
        ? or(ilike(orders.orderNumber, term), eq(orders.id, possibleId), ilike(customers.name, term), ilike(customers.phone, term))
        : or(ilike(orders.orderNumber, term), ilike(customers.name, term), ilike(customers.phone, term))
    );
  }
  if (dateFrom) conditions.push(gte(orders.paymentConfirmedAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(orders.paymentConfirmedAt, new Date(dateTo)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const columns = {
    ...FULL_ORDER_COLUMNS,
    customerVirtualAccountNumber: customers.virtualAccountNumber,
    customerVirtualAccountBank: customers.virtualAccountBank,
  };

  const [rows, [{ total, totalAmount }], [{ trackedCount }]] = await Promise.all([
    db
      .select(columns)
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(depots, eq(orders.depotId, depots.id))
      .leftJoin(products, eq(orders.productId, products.id))
      .leftJoin(pfis, eq(orders.pfiId, pfis.id))
      .where(whereClause)
      .orderBy(asc(orders.paymentConfirmedAt), asc(orders.id))
      .limit(limitNum)
      .offset(offset),
    // Independent of pagination, over the same filtered set — so the stat
    // cards can never disagree with the rows a filter/search actually shows.
    db
      .select({ total: count(), totalAmount: sql`COALESCE(SUM(${orders.totalAmount}), 0)` })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(whereClause),
    db
      .select({ trackedCount: sql`COUNT(DISTINCT ${orders.id})` })
      .from(orders)
      .innerJoin(orderDepositAllocations, eq(orders.id, orderDepositAllocations.orderId))
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(whereClause),
  ]);

  const orderIds = rows.map((r) => r.id);
  const funding = orderIds.length
    ? await db
        .select({
          orderId: orderDepositAllocations.orderId,
          depositId: orderDepositAllocations.depositId,
          amount: orderDepositAllocations.amount,
          depositReference: deposits.reference,
          depositCreatedAt: deposits.createdAt,
          paystackDetails: deposits.paystackDetails,
          recorderFirstName: staff.firstName,
          recorderSurname: staff.surname,
        })
        .from(orderDepositAllocations)
        .innerJoin(deposits, eq(orderDepositAllocations.depositId, deposits.id))
        .leftJoin(staff, eq(deposits.recordedBy, staff.id))
        .where(inArray(orderDepositAllocations.orderId, orderIds))
        .orderBy(asc(orderDepositAllocations.createdAt))
    : [];

  const fundingByOrder = new Map();
  for (const f of funding) {
    if (!fundingByOrder.has(f.orderId)) fundingByOrder.set(f.orderId, []);
    fundingByOrder.get(f.orderId).push(f);
  }

  const decorated = rows.map((row) => {
    const orderFunding = fundingByOrder.get(row.id) || [];
    const allocated = orderFunding.reduce((sum, f) => sum + Number(f.amount || 0), 0);
    const fundingTracked = orderFunding.length > 0;
    return {
      ...row,
      funding: orderFunding,
      fundingTracked,
      unattributedAmount: fundingTracked ? Math.max(0, Number(row.totalAmount || 0) - allocated) : 0,
    };
  });

  return {
    orders: decorated.map(formatOrderRow),
    totals: {
      count: total,
      totalAmount: Number(totalAmount),
      trackedCount: Number(trackedCount),
      notTrackedCount: total - Number(trackedCount),
    },
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

const findPayableOrders = async (scopeUser) => {
  const conditions = [
    eq(orders.paymentStatus, "Unpaid"),
    eq(orders.status, "Pending"),
    sql`${customers.balance} >= ${orders.totalAmount}`,
  ];
  const scope = scopeCondition(scopeUser, { depotColumn: orders.depotId, pfiColumn: orders.pfiId });
  if (scope) conditions.push(scope);

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
    .where(and(...conditions))
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
  findFinanceReport,
  create,
  update,
  findUnpaidByCustomer,
  findOpenByCustomer,
  countByPfi,
  findPayableOrders,
  findStalePending,
};
