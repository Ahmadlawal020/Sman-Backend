const { eq, and, sql, desc, gte, lte } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  consumerOrder,
  customerCredits,
  walletHolds,
  consumerPfi,
  consumerPfimovement,
  administrationDeliveryinventory,
  administrationDeliverysale,
  administrationDeliverycustomer,
  consumerFleettruck,
  consumerFleetledgerentry,
  administrationStaffdailysalesreport,
  dailyReportExtras,
  administrationOfflinesales,
} = require("../db/schema");
const { fleetTruckRepo } = require("../repositories");
const { fromLiveStatus } = require("../utils/orderStatusMapping");

// Read-only aggregation, SQL-side, over the same records the existing
// screens use. Nothing here writes.

const num = (value) => Number(value || 0);

const dateConditions = (column, dateFrom, dateTo) => {
  const conditions = [];
  if (dateFrom) conditions.push(gte(column, new Date(dateFrom).toISOString()));
  if (dateTo) conditions.push(lte(column, new Date(dateTo).toISOString()));
  return conditions;
};

/**
 * consumer_order has no separate paymentStatus axis (see
 * utils/orderStatusMapping.js) — grouped raw by (status, releaseStatus) and
 * translated to Sman vocabulary in JS, since fromLiveStatus needs both
 * columns together and SQL GROUP BY can't call it.
 */
const salesSummary = async ({ dateFrom, dateTo } = {}) => {
  const conditions = dateConditions(consumerOrder.createdAt, dateFrom, dateTo);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      status: consumerOrder.status,
      releaseStatus: consumerOrder.releaseStatus,
      orderCount: sql`count(*)::int`,
      totalLitres: sql`COALESCE(SUM(${consumerOrder.quantity}), 0)::bigint`,
      totalValue: sql`COALESCE(SUM(${consumerOrder.totalPrice}::numeric), 0)`,
    })
    .from(consumerOrder)
    .where(whereClause)
    .groupBy(consumerOrder.status, consumerOrder.releaseStatus);

  const byStatus = rows.map((row) => {
    const smanStatus = fromLiveStatus(row);
    return {
      status: smanStatus,
      paymentStatus: ["Paid", "Released", "Loading", "Completed"].includes(smanStatus) ? "Paid" : "Unpaid",
      orderCount: row.orderCount,
      totalLitres: row.totalLitres,
      totalValue: row.totalValue,
    };
  });

  const totals = byStatus.reduce(
    (acc, row) => ({
      orders: acc.orders + row.orderCount,
      litres: acc.litres + num(row.totalLitres),
      value: acc.value + num(row.totalValue),
      paidValue: acc.paidValue + (row.paymentStatus === "Paid" ? num(row.totalValue) : 0),
    }),
    { orders: 0, litres: 0, value: 0, paidValue: 0 }
  );

  return { totals, byStatus };
};

/**
 * consumer_customer has no balance column, and there is no live "deposits"
 * table at all — the wallet is entirely the sman ledger (see
 * repositories/customer.repository.js's header comment). "Movement" is read
 * straight off sman.customer_credits: a positive entry is a credit
 * (deposit), a negative one a debit (applied to an order).
 */
const walletSummary = async ({ dateFrom, dateTo } = {}) => {
  const conditions = dateConditions(customerCredits.createdAt, dateFrom, dateTo);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [movement] = await db
    .select({
      credits: sql`COALESCE(SUM(CASE WHEN ${customerCredits.amount}::numeric > 0 THEN ${customerCredits.amount}::numeric ELSE 0 END), 0)`,
      debits: sql`COALESCE(SUM(CASE WHEN ${customerCredits.amount}::numeric < 0 THEN -${customerCredits.amount}::numeric ELSE 0 END), 0)`,
      entryCount: sql`count(*)::int`,
    })
    .from(customerCredits)
    .where(whereClause);

  const perCustomer = db.$with("per_customer").as(
    db
      .select({
        customerId: customerCredits.customerId,
        balance: sql`SUM(${customerCredits.amount}::numeric)`.as("balance"),
      })
      .from(customerCredits)
      .groupBy(customerCredits.customerId)
  );
  const [balances] = await db
    .with(perCustomer)
    .select({
      totalBalance: sql`COALESCE(SUM(${perCustomer.balance}), 0)`,
      customersWithBalance: sql`COUNT(*) FILTER (WHERE ${perCustomer.balance} > 0)::int`,
    })
    .from(perCustomer);

  const [held] = await db
    .select({ totalHeld: sql`COALESCE(SUM(${walletHolds.amount}::numeric), 0)` })
    .from(walletHolds)
    .where(eq(walletHolds.status, "active"));

  return { movement, balances, activeHolds: held };
};

/**
 * No soldQtyLitres/totalAmount columns on consumer_pfi — sold is the
 * consumer_pfimovement ledger sum, and value is starting*pricePerLitre (see
 * repositories/pfi.repository.js's header comment).
 */
const pfiSummary = async () => {
  const soldByPfi = db.$with("sold_by_pfi").as(
    db
      .select({
        pfiId: consumerPfimovement.pfiId,
        sold: sql`SUM(${consumerPfimovement.qtyLitres}::numeric)`.as("sold"),
      })
      .from(consumerPfimovement)
      .groupBy(consumerPfimovement.pfiId)
  );

  const rows = await db
    .with(soldByPfi)
    .select({
      status: consumerPfi.status,
      pfiCount: sql`count(*)::int`,
      startingLitres: sql`COALESCE(SUM(${consumerPfi.startingQtyLitres}::numeric), 0)::bigint`,
      soldLitres: sql`COALESCE(SUM(COALESCE(${soldByPfi.sold}, 0)), 0)::bigint`,
      totalValue: sql`COALESCE(SUM(${consumerPfi.startingQtyLitres}::numeric * COALESCE(${consumerPfi.pricePerLitre}::numeric, 0)), 0)`,
    })
    .from(consumerPfi)
    .leftJoin(soldByPfi, eq(soldByPfi.pfiId, consumerPfi.id))
    .groupBy(consumerPfi.status);
  return { byStatus: rows };
};

// Delivery sales ledger totals: sales value vs payments received, and the
// gap between them.
const deliverySalesTotals = async ({ dateFrom, dateTo, customerType } = {}) => {
  const conditions = [];
  if (dateFrom) conditions.push(gte(administrationDeliverysale.dateLoaded, dateFrom));
  if (dateTo) conditions.push(lte(administrationDeliverysale.dateLoaded, dateTo));
  if (customerType) conditions.push(eq(administrationDeliverycustomer.customerType, customerType));

  const [totals] = await db
    .select({
      saleCount: sql`count(*)::int`,
      quantity: sql`COALESCE(SUM(${administrationDeliverysale.quantity}::numeric), 0)`,
      salesValue: sql`COALESCE(SUM(${administrationDeliverysale.salesValue}::numeric), 0)`,
      paymentAmount: sql`COALESCE(SUM(${administrationDeliverysale.paymentAmount}::numeric), 0)`,
      outstanding: sql`COALESCE(SUM(${administrationDeliverysale.salesValue}::numeric - ${administrationDeliverysale.paymentAmount}::numeric), 0)`,
    })
    .from(administrationDeliverysale)
    .leftJoin(administrationDeliverycustomer, eq(administrationDeliverysale.customerId, administrationDeliverycustomer.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  return totals;
};

const deliverySummary = async ({ dateFrom, dateTo } = {}) => {
  const conditions = dateConditions(administrationDeliveryinventory.createdAt, dateFrom, dateTo);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const byStatus = await db
    .select({
      loadingStatus: administrationDeliveryinventory.loadingStatus,
      releaseStatus: administrationDeliveryinventory.releaseStatus,
      allocationCount: sql`count(*)::int`,
      totalLitres: sql`COALESCE(SUM(${administrationDeliveryinventory.quantityAllocated}::numeric), 0)`,
    })
    .from(administrationDeliveryinventory)
    .where(whereClause)
    .groupBy(administrationDeliveryinventory.loadingStatus, administrationDeliveryinventory.releaseStatus);

  const salesLedger = await deliverySalesTotals({ dateFrom, dateTo });

  return { byStatus, salesLedger };
};

const stationSummary = async ({ dateFrom, dateTo } = {}) => {
  const totals = await deliverySalesTotals({ dateFrom, dateTo, customerType: "filling_station" });

  const [stations] = await db
    .select({
      stationCount: sql`count(*)::int`,
      active: sql`COUNT(*) FILTER (WHERE ${administrationDeliverycustomer.status} = 'active')::int`,
    })
    .from(administrationDeliverycustomer)
    .where(eq(administrationDeliverycustomer.customerType, "filling_station"));

  return { stations, salesLedger: totals };
};

const fleetSummary = async ({ dateFrom, dateTo } = {}) => {
  const ledger = await fleetTruckRepo.summarizeLedger({ dateFrom, dateTo });

  const conditions = [];
  if (dateFrom) conditions.push(gte(consumerFleetledgerentry.date, dateFrom));
  if (dateTo) conditions.push(lte(consumerFleetledgerentry.date, dateTo));

  const perTruck = await db
    .select({
      truckId: consumerFleettruck.id,
      plateNumber: consumerFleettruck.plateNumber,
      expenses: sql`COALESCE(SUM(CASE WHEN ${consumerFleetledgerentry.entryType} = 'expense' THEN ${consumerFleetledgerentry.amount}::numeric ELSE 0 END), 0)`,
      income: sql`COALESCE(SUM(CASE WHEN ${consumerFleetledgerentry.entryType} = 'income' THEN ${consumerFleetledgerentry.amount}::numeric ELSE 0 END), 0)`,
    })
    .from(consumerFleetledgerentry)
    .innerJoin(consumerFleettruck, eq(consumerFleetledgerentry.truckId, consumerFleettruck.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(consumerFleettruck.id, consumerFleettruck.plateNumber)
    .orderBy(desc(sql`SUM(CASE WHEN ${consumerFleetledgerentry.entryType} = 'expense' THEN ${consumerFleetledgerentry.amount}::numeric ELSE 0 END)`))
    .limit(50);

  return { ledger, perTruck };
};

/**
 * Who owes us money on the delivery sales ledger, biggest first:
 * outstanding = sales value - payments, per customer.
 */
const outstandingPayments = async ({ limit = 50 } = {}) => {
  const rows = await db
    .select({
      customerId: administrationDeliverysale.customerId,
      customerName: sql`COALESCE(MAX(${administrationDeliverycustomer.customerName}), MAX(${administrationDeliverysale.customerName}))`,
      customerType: sql`MAX(${administrationDeliverycustomer.customerType})`,
      salesValue: sql`COALESCE(SUM(${administrationDeliverysale.salesValue}::numeric), 0)`,
      paymentAmount: sql`COALESCE(SUM(${administrationDeliverysale.paymentAmount}::numeric), 0)`,
      outstanding: sql`COALESCE(SUM(${administrationDeliverysale.salesValue}::numeric - ${administrationDeliverysale.paymentAmount}::numeric), 0)`,
    })
    .from(administrationDeliverysale)
    .leftJoin(administrationDeliverycustomer, eq(administrationDeliverysale.customerId, administrationDeliverycustomer.id))
    .groupBy(administrationDeliverysale.customerId)
    .having(sql`SUM(${administrationDeliverysale.salesValue}::numeric - ${administrationDeliverysale.paymentAmount}::numeric) > 0`)
    .orderBy(desc(sql`SUM(${administrationDeliverysale.salesValue}::numeric - ${administrationDeliverysale.paymentAmount}::numeric)`))
    .limit(Math.min(200, limit));

  const totalOutstanding = rows.reduce((sum, row) => sum + num(row.outstanding), 0);
  return { totalOutstanding, customers: rows };
};

/**
 * "approved" lives on sman.daily_report_extras, not the live report table
 * itself (see db/schema/sman/dailyReportExtras.js) — everything else
 * (location/date/litresSoldToday/totalSalesAmount/amountPaid/numTrucksSold)
 * is a direct live column, just renamed from the old reportDate/litresSold/
 * truckCount (see repositories/dailyReport.repository.js).
 */
const dailyReportSummary = async ({ dateFrom, dateTo, location } = {}) => {
  const conditions = [eq(dailyReportExtras.status, "approved")];
  if (dateFrom) conditions.push(gte(administrationStaffdailysalesreport.date, dateFrom));
  if (dateTo) conditions.push(lte(administrationStaffdailysalesreport.date, dateTo));
  if (location) conditions.push(eq(administrationStaffdailysalesreport.location, location));

  const byLocation = await db
    .select({
      location: administrationStaffdailysalesreport.location,
      reportCount: sql`count(*)::int`,
      litresSold: sql`COALESCE(SUM(${administrationStaffdailysalesreport.litresSoldToday}::numeric), 0)`,
      salesAmount: sql`COALESCE(SUM(${administrationStaffdailysalesreport.totalSalesAmount}::numeric), 0)`,
      amountPaid: sql`COALESCE(SUM(${administrationStaffdailysalesreport.amountPaid}::numeric), 0)`,
      truckCount: sql`COALESCE(SUM(${administrationStaffdailysalesreport.numTrucksSold}), 0)::int`,
    })
    .from(administrationStaffdailysalesreport)
    .innerJoin(dailyReportExtras, eq(dailyReportExtras.reportId, administrationStaffdailysalesreport.id))
    .where(and(...conditions))
    .groupBy(administrationStaffdailysalesreport.location);

  return { byLocation };
};

const revenueSummary = async ({ dateFrom, dateTo } = {}) => {
  // "Paid" in Sman vocabulary is any of paid/released/loaded live (see
  // utils/orderStatusMapping.js) — pending/canceled/sold are excluded.
  const orderConditions = [
    sql`${consumerOrder.status} IN ('paid', 'released', 'loaded')`,
    ...dateConditions(consumerOrder.createdAt, dateFrom, dateTo),
  ];
  const [orderRevenue] = await db
    .select({ total: sql`COALESCE(SUM(${consumerOrder.totalPrice}::numeric), 0)`, orderCount: sql`count(*)::int` })
    .from(consumerOrder)
    .where(and(...orderConditions));

  const offlineConditions = [
    eq(administrationOfflinesales.status, "approved"),
    ...dateConditions(administrationOfflinesales.createdAt, dateFrom, dateTo),
  ];
  const [offlineRevenue] = await db
    .select({ total: sql`COALESCE(SUM(${administrationOfflinesales.totalPrice}::numeric), 0)`, saleCount: sql`count(*)::int` })
    .from(administrationOfflinesales)
    .where(and(...offlineConditions));

  const deliveryRevenue = await deliverySalesTotals({ dateFrom, dateTo });

  return {
    orders: orderRevenue,
    offlineSales: offlineRevenue,
    deliverySales: deliveryRevenue,
    combined: num(orderRevenue.total) + num(offlineRevenue.total) + num(deliveryRevenue.paymentAmount),
  };
};

module.exports = {
  salesSummary,
  walletSummary,
  pfiSummary,
  deliverySummary,
  fleetSummary,
  stationSummary,
  outstandingPayments,
  dailyReportSummary,
  revenueSummary,
};
