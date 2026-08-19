const { eq, and, or, ilike, inArray, desc, asc, count, sql, gte, lte } = require("drizzle-orm");
const { db } = require("../config/db");
const { consumerOrder, consumerOrderproduct, consumerCustomer, consumerProduct, consumerPfi, consumerStates, customerCredits, walletHolds, consumerOrderpaymentrecord, administrationUser } = require("../db/schema");
const { generateOrderReference, parseOrderReference } = require("../utils/helpers");
const { fromLiveStatus, STATUS_TO_LIVE } = require("../utils/orderStatusMapping");

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
  // status/paymentStatus: Sman vocabulary throughout the rest of the app —
  // see utils/orderStatusMapping.js and orderStatus.service.js's header
  // comment for why. customerId: consumer_order's FK column is userId
  // despite the name.
  return {
    ...row,
    orderNumber: ref,
    reference: ref,
    customerId: row.userId,
    status: fromLiveStatus(row),
    paymentStatus: ["Paid", "Released", "Loading", "Completed"].includes(fromLiveStatus(row)) ? "Paid" : "Unpaid",
    // deliveryType is Sman vocabulary for release_type — every caller
    // (email, SMS, tracking, WhatsApp) reads .deliveryType, never .releaseType.
    deliveryType: row.releaseType,
    // tracking.service.js's buildReached/currentStage read these Sman-vocabulary
    // stage-timestamp names on every order object, not just the raw select
    // trackByRef builds by hand — aliased here too so the customer portal's
    // own order-detail view (which reads through formatOrderRow) gets the
    // same stage timeline the public tracking feed does. No live cancelledAt
    // column exists (see this file's header comment) — updatedAt is the best
    // available stand-in for "when it left Pending", not a guess at a real
    // cancellation timestamp.
    loadingStartedAt: row.loadingDatetime,
    completedAt: row.securityExitedAt,
    cancelledAt: row.status === "canceled" ? row.updatedAt : null,
    // The dashboard's orders pages read order.depotName || order.state for
    // the "Location" column — there is no depot on a live order (see this
    // file's header comment), but the state name is available and joined in
    // as stateName above; aliased here so the existing frontend fallback
    // actually finds it instead of showing blank.
    state: row.stateName,
    // Money + pay-into aliases. The WhatsApp copy (whatsapp/copy.js
    // orderCreated), the engine's ORDER_CREATED payload, and the customer
    // portal all read .totalAmount and .virtualAccount* off order objects —
    // pre-cutover column names. Without these, every WhatsApp order
    // confirmation rendered "*Total: ₦0* … Bank: undefined". The paidTo*
    // columns are the depot's bank account (manual-deposit-only model), which
    // is exactly what "virtual account" means to those callers now.
    totalAmount: row.totalPrice,
    virtualAccountBank: row.paidToBankName,
    virtualAccountNumber: row.paidToAccountNumber,
    virtualAccountName: row.paidToAccountName,
  };
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
  productSku: consumerProduct.abbreviation,
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
  // `status` arrives in Sman vocabulary (Pending/Paid/Released/Loading/
  // Completed/Cancelled/Expired) from every caller — translate for the live
  // column. Loading and Completed share the live "loaded" value, so those
  // two also need release_status to tell them apart (see
  // utils/orderStatusMapping.js).
  if (status && STATUS_TO_LIVE[status]) {
    conditions.push(eq(consumerOrder.status, STATUS_TO_LIVE[status]));
    if (status === "Loading") {
      conditions.push(sql`(${consumerOrder.releaseStatus} IS NULL OR ${consumerOrder.releaseStatus} = 'pending')`);
    } else if (status === "Completed") {
      conditions.push(sql`${consumerOrder.releaseStatus} IN ('delivered', 'picked')`);
    }
  }
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
        // Without this, formatOrderRow's customerId alias is undefined on
        // every list row — the joined display fields were selected but the
        // owning FK itself was not.
        userId: consumerOrder.userId,
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
 * Every confirmed payment, order by order, with the deposit(s) that funded
 * it — controllers/administration/financeReport.controller.js's
 * getFinanceReport called this and it never existed (relation/function
 * missing, 500 on every call). Funding comes from sman.customer_credits:
 * a negative entry with orderId set is credit applied to that order, and
 * its paymentRecordId (when set) points at the real
 * consumer_orderpaymentrecord row for reference/bank details. There is no
 * live distinction between Paystack and manual funding — Paystack is
 * disabled (see services/payment.service.js) — so paystackDetails is always
 * null; every real entry here is a manual bank deposit.
 *
 * `fundingTracked` is false for an order with zero customer_credits rows: it
 * was paid before (or outside) the credit ledger, not an error. For a
 * tracked order, `unattributedAmount` is what's left of the order total once
 * its tracked funding is subtracted — never negative, and always 0 for an
 * untracked order (nothing to compare against).
 */
const findFinanceReport = async ({
  search,
  paymentStatus,
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
  if (search) {
    const possibleId = parseOrderReference(search);
    if (possibleId) {
      conditions.push(eq(consumerOrder.id, possibleId));
    } else {
      const term = `%${search}%`;
      conditions.push(
        or(
          ilike(consumerCustomer.firstName, term),
          ilike(consumerCustomer.lastName, term),
          ilike(consumerCustomer.companyName, term)
        )
      );
    }
  }
  // "Paid" in Sman vocabulary is any of paid/released/loaded live (see
  // utils/orderStatusMapping.js) — matches revenueSummary's own definition.
  if (paymentStatus === "Paid") {
    conditions.push(sql`${consumerOrder.status} IN ('paid', 'released', 'loaded')`);
  } else if (paymentStatus === "Unpaid") {
    conditions.push(sql`${consumerOrder.status} NOT IN ('paid', 'released', 'loaded')`);
  }
  if (dateFrom) conditions.push(gte(consumerOrder.createdAt, new Date(dateFrom).toISOString()));
  if (dateTo) {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? `${dateTo}T23:59:59.999Z` : dateTo;
    conditions.push(lte(consumerOrder.createdAt, new Date(end).toISOString()));
  }
  // PFI-scoped staff only see orders tied to a PFI in their scope — see
  // repositories/pfiExpense.repository.js's header comment for why this is
  // narrower than the old depot/LPG-implied scope rather than a guess at one.
  if (scopeUser && !scopeUser.canViewAllLocations) {
    const { pfiIds = [] } = scopeUser.scope || {};
    conditions.push(inArray(consumerOrder.pfiId, pfiIds.length ? pfiIds : [-1]));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }], allMatching] = await Promise.all([
    db
      .select({
        id: consumerOrder.id,
        userId: consumerOrder.userId,
        quantity: consumerOrder.quantity,
        totalPrice: consumerOrder.totalPrice,
        status: consumerOrder.status,
        releaseType: consumerOrder.releaseType,
        paidToAccountName: consumerOrder.paidToAccountName,
        paidToAccountNumber: consumerOrder.paidToAccountNumber,
        paidToBankName: consumerOrder.paidToBankName,
        paymentConfirmedAt: consumerOrder.paymentConfirmedAt,
        createdAt: consumerOrder.createdAt,
        customerName: consumerCustomer.firstName,
        customerLastName: consumerCustomer.lastName,
        customerEmail: consumerCustomer.email,
        customerPhone: consumerCustomer.phoneNumber,
        customerCompanyName: consumerCustomer.companyName,
        productName: consumerProduct.name,
      })
      .from(consumerOrder)
      .leftJoin(consumerCustomer, eq(consumerOrder.userId, consumerCustomer.id))
      .leftJoin(consumerOrderproduct, eq(consumerOrderproduct.orderId, consumerOrder.id))
      .leftJoin(consumerProduct, eq(consumerOrderproduct.productId, consumerProduct.id))
      .where(whereClause)
      .orderBy(desc(consumerOrder.createdAt))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(consumerOrder).leftJoin(consumerCustomer, eq(consumerOrder.userId, consumerCustomer.id)).where(whereClause),
    // Full filtered set (unpaginated) just for the totals — same reasoning
    // as listExpenses: the summary must never disagree with the filter.
    db
      .select({ id: consumerOrder.id, totalPrice: consumerOrder.totalPrice })
      .from(consumerOrder)
      .leftJoin(consumerCustomer, eq(consumerOrder.userId, consumerCustomer.id))
      .where(whereClause),
  ]);

  const orderIds = rows.map((r) => r.id);
  const fundingRows = orderIds.length
    ? await db
        .select({
          orderId: customerCredits.orderId,
          depositId: customerCredits.id,
          amount: customerCredits.amount,
          depositReference: customerCredits.reference,
          depositCreatedAt: customerCredits.createdAt,
          recorderName: administrationUser.fullName,
          paymentRecordReference: consumerOrderpaymentrecord.transactionReference,
        })
        .from(customerCredits)
        .leftJoin(administrationUser, eq(customerCredits.createdBy, administrationUser.id))
        .leftJoin(consumerOrderpaymentrecord, eq(customerCredits.paymentRecordId, consumerOrderpaymentrecord.id))
        .where(inArray(customerCredits.orderId, orderIds))
    : [];

  const fundingByOrder = new Map();
  for (const f of fundingRows) {
    if (!fundingByOrder.has(f.orderId)) fundingByOrder.set(f.orderId, []);
    // administration_user has one fullName column, not first/last — split on
    // the first space as the closest available approximation.
    const [recorderFirstName, ...rest] = (f.recorderName || "").split(" ");
    fundingByOrder.get(f.orderId).push({
      depositId: f.depositId,
      amount: f.amount,
      depositReference: f.paymentRecordReference || f.depositReference || null,
      depositCreatedAt: f.depositCreatedAt,
      paystackDetails: null,
      recorderFirstName: recorderFirstName || null,
      recorderSurname: rest.join(" ") || null,
    });
  }

  const orders = rows.map((row) => {
    const funding = fundingByOrder.get(row.id) || [];
    const fundingTracked = funding.length > 0;
    const fundedAmount = funding.reduce((sum, f) => sum + Math.abs(Number(f.amount) || 0), 0);
    const unattributedAmount = fundingTracked
      ? Math.max(0, Number(row.totalPrice) - fundedAmount)
      : 0;
    const formatted = formatOrderRow(row);
    return {
      ...formatted,
      customerVirtualAccountNumber: null,
      customerVirtualAccountBank: null,
      virtualAccountNumber: row.paidToAccountNumber,
      virtualAccountBank: row.paidToBankName,
      virtualAccountName: row.paidToAccountName,
      funding,
      fundingTracked,
      unattributedAmount,
    };
  });

  // trackedCount/notTrackedCount below are computed from the current page
  // only — fundingByOrder was only populated for this page's order ids.
  // An accurate full-filtered-set split would need a second funding query
  // against every matching order id, not just the page's.
  const totalAmount = allMatching.reduce((sum, o) => sum + Number(o.totalPrice || 0), 0);

  return {
    orders,
    totals: {
      count: Number(total),
      totalAmount,
      trackedCount: orders.filter((o) => o.fundingTracked).length,
      notTrackedCount: orders.filter((o) => !o.fundingTracked).length,
    },
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

  // Every order in production has exactly one consumer_orderproduct line
  // item (see this file's header comment) — its id is what
  // consumer_truckallocation.order_product_id needs, so it's stamped onto
  // the returned order (additive, like customerId/status/deliveryType)
  // rather than making every caller re-query for it.
  let orderProductId = null;
  if (productId != null) {
    const [lineItem] = await tx
      .insert(consumerOrderproduct)
      .values({
        orderId: row.id,
        productId,
        quantity,
        price: String(price ?? 0),
      })
      .returning();
    orderProductId = lineItem?.id ?? null;
  }

  return { ...formatOrderRow(row), orderProductId };
};

/**
 * The order's single consumer_orderproduct line-item id — what
 * consumer_truckallocation.order_product_id needs. create() above stamps
 * this onto its own return value; callers with only an order id (not the
 * freshly-created row) look it up here instead of re-querying by hand.
 */
const getLineItemId = async (orderId, tx = db) => {
  const [row] = await tx
    .select({ id: consumerOrderproduct.id })
    .from(consumerOrderproduct)
    .where(eq(consumerOrderproduct.orderId, orderId))
    .limit(1);
  return row?.id ?? null;
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
  findFinanceReport,
  create,
  update,
  getLineItemId,
  findUnpaidByCustomer,
  findOpenByCustomer,
  countByPfi,
  findPayableOrders,
  findStalePending,
};
