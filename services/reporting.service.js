const { eq, and, sql, desc, gte, lte } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  orders,
  deposits,
  customers,
  walletHolds,
  pfis,
  deliveryInventory,
  deliverySales,
  deliveryCustomers,
  fleetTrucks,
  fleetLedgerEntries,
  dailyReports,
  offlineSales,
} = require("../db/schema");
const { fleetTruckRepo } = require("../repositories");

// Read-only aggregation, SQL-side, over the same records the existing
// screens use: delivery_sales is the delivery sales ledger, fleet_ledger_
// entries the fleet book. Nothing here writes.

const num = (value) => Number(value || 0);

const dateConditions = (column, dateFrom, dateTo) => {
  const conditions = [];
  if (dateFrom) conditions.push(gte(column, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(column, new Date(dateTo)));
  return conditions;
};

const salesSummary = async ({ dateFrom, dateTo } = {}) => {
  const conditions = dateConditions(orders.createdAt, dateFrom, dateTo);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const byStatus = await db
    .select({
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      orderCount: sql`count(*)::int`,
      totalLitres: sql`COALESCE(SUM(${orders.quantity}), 0)::bigint`,
      totalValue: sql`COALESCE(SUM(${orders.totalAmount}), 0)`,
    })
    .from(orders)
    .where(whereClause)
    .groupBy(orders.status, orders.paymentStatus);

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

const walletSummary = async ({ dateFrom, dateTo } = {}) => {
  const conditions = dateConditions(deposits.createdAt, dateFrom, dateTo);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [movement] = await db
    .select({
      credits: sql`COALESCE(SUM(CASE WHEN ${deposits.type} = 'credit' THEN ${deposits.amount} ELSE 0 END), 0)`,
      debits: sql`COALESCE(SUM(CASE WHEN ${deposits.type} = 'debit' THEN ${deposits.amount} ELSE 0 END), 0)`,
      entryCount: sql`count(*)::int`,
    })
    .from(deposits)
    .where(whereClause);

  const [balances] = await db
    .select({
      totalBalance: sql`COALESCE(SUM(${customers.balance}), 0)`,
      customersWithBalance: sql`COUNT(*) FILTER (WHERE ${customers.balance} > 0)::int`,
    })
    .from(customers);

  const [held] = await db
    .select({ totalHeld: sql`COALESCE(SUM(${walletHolds.amount}), 0)` })
    .from(walletHolds)
    .where(eq(walletHolds.status, "active"));

  return { movement, balances, activeHolds: held };
};

const pfiSummary = async () => {
  const rows = await db
    .select({
      status: pfis.status,
      pfiCount: sql`count(*)::int`,
      startingLitres: sql`COALESCE(SUM(${pfis.startingQtyLitres}), 0)::bigint`,
      soldLitres: sql`COALESCE(SUM(${pfis.soldQtyLitres}), 0)::bigint`,
      remainingLitres: sql`COALESCE(SUM(${pfis.startingQtyLitres} - ${pfis.soldQtyLitres}), 0)::bigint`,
      totalValue: sql`COALESCE(SUM(${pfis.totalAmount}), 0)`,
    })
    .from(pfis)
    .groupBy(pfis.status);
  return { byStatus: rows };
};

// Delivery sales ledger totals: sales value vs payments received, and the
// gap between them — the same arithmetic the Django ledger screens show.
const deliverySalesTotals = async ({ dateFrom, dateTo, customerType } = {}) => {
  const conditions = [];
  if (dateFrom) conditions.push(gte(deliverySales.dateLoaded, dateFrom));
  if (dateTo) conditions.push(lte(deliverySales.dateLoaded, dateTo));
  if (customerType) conditions.push(eq(deliveryCustomers.customerType, customerType));

  const [totals] = await db
    .select({
      saleCount: sql`count(*)::int`,
      quantity: sql`COALESCE(SUM(${deliverySales.quantity}), 0)`,
      salesValue: sql`COALESCE(SUM(${deliverySales.salesValue}), 0)`,
      paymentAmount: sql`COALESCE(SUM(${deliverySales.paymentAmount}), 0)`,
      outstanding: sql`COALESCE(SUM(${deliverySales.salesValue} - ${deliverySales.paymentAmount}), 0)`,
    })
    .from(deliverySales)
    .leftJoin(deliveryCustomers, eq(deliverySales.customerId, deliveryCustomers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  return totals;
};

const deliverySummary = async ({ dateFrom, dateTo } = {}) => {
  const conditions = dateConditions(deliveryInventory.createdAt, dateFrom, dateTo);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const byStatus = await db
    .select({
      loadingStatus: deliveryInventory.loadingStatus,
      releaseStatus: deliveryInventory.releaseStatus,
      allocationCount: sql`count(*)::int`,
      totalLitres: sql`COALESCE(SUM(${deliveryInventory.quantityAllocated}), 0)`,
    })
    .from(deliveryInventory)
    .where(whereClause)
    .groupBy(deliveryInventory.loadingStatus, deliveryInventory.releaseStatus);

  const salesLedger = await deliverySalesTotals({ dateFrom, dateTo });

  return { byStatus, salesLedger };
};

const stationSummary = async ({ dateFrom, dateTo } = {}) => {
  const totals = await deliverySalesTotals({ dateFrom, dateTo, customerType: "filling_station" });

  const [stations] = await db
    .select({
      stationCount: sql`count(*)::int`,
      active: sql`COUNT(*) FILTER (WHERE ${deliveryCustomers.status} = 'active')::int`,
    })
    .from(deliveryCustomers)
    .where(eq(deliveryCustomers.customerType, "filling_station"));

  return { stations, salesLedger: totals };
};

const fleetSummary = async ({ dateFrom, dateTo } = {}) => {
  const ledger = await fleetTruckRepo.summarizeLedger({ dateFrom, dateTo });

  const conditions = [];
  if (dateFrom) conditions.push(gte(fleetLedgerEntries.entryDate, dateFrom));
  if (dateTo) conditions.push(lte(fleetLedgerEntries.entryDate, dateTo));

  const perTruck = await db
    .select({
      truckId: fleetTrucks.id,
      plateNumber: fleetTrucks.plateNumber,
      expenses: sql`COALESCE(SUM(CASE WHEN ${fleetLedgerEntries.entryType} = 'expense' THEN ${fleetLedgerEntries.amount} ELSE 0 END), 0)`,
      income: sql`COALESCE(SUM(CASE WHEN ${fleetLedgerEntries.entryType} = 'income' THEN ${fleetLedgerEntries.amount} ELSE 0 END), 0)`,
    })
    .from(fleetLedgerEntries)
    .innerJoin(fleetTrucks, eq(fleetLedgerEntries.truckId, fleetTrucks.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(fleetTrucks.id, fleetTrucks.plateNumber)
    .orderBy(desc(sql`SUM(CASE WHEN ${fleetLedgerEntries.entryType} = 'expense' THEN ${fleetLedgerEntries.amount} ELSE 0 END)`))
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
      customerId: deliverySales.customerId,
      customerName: sql`COALESCE(MAX(${deliveryCustomers.name}), MAX(${deliverySales.customerName}))`,
      customerType: sql`MAX(${deliveryCustomers.customerType})`,
      salesValue: sql`COALESCE(SUM(${deliverySales.salesValue}), 0)`,
      paymentAmount: sql`COALESCE(SUM(${deliverySales.paymentAmount}), 0)`,
      outstanding: sql`COALESCE(SUM(${deliverySales.salesValue} - ${deliverySales.paymentAmount}), 0)`,
    })
    .from(deliverySales)
    .leftJoin(deliveryCustomers, eq(deliverySales.customerId, deliveryCustomers.id))
    .groupBy(deliverySales.customerId)
    .having(sql`SUM(${deliverySales.salesValue} - ${deliverySales.paymentAmount}) > 0`)
    .orderBy(desc(sql`SUM(${deliverySales.salesValue} - ${deliverySales.paymentAmount})`))
    .limit(Math.min(200, limit));

  const totalOutstanding = rows.reduce((sum, row) => sum + num(row.outstanding), 0);
  return { totalOutstanding, customers: rows };
};

const dailyReportSummary = async ({ dateFrom, dateTo, location } = {}) => {
  const conditions = [eq(dailyReports.status, "approved")];
  if (dateFrom) conditions.push(gte(dailyReports.reportDate, dateFrom));
  if (dateTo) conditions.push(lte(dailyReports.reportDate, dateTo));
  if (location) conditions.push(eq(dailyReports.location, location));

  const byLocation = await db
    .select({
      location: dailyReports.location,
      reportCount: sql`count(*)::int`,
      litresSold: sql`COALESCE(SUM(${dailyReports.litresSold}), 0)`,
      salesAmount: sql`COALESCE(SUM(${dailyReports.totalSalesAmount}), 0)`,
      amountPaid: sql`COALESCE(SUM(${dailyReports.amountPaid}), 0)`,
      truckCount: sql`COALESCE(SUM(${dailyReports.truckCount}), 0)::int`,
    })
    .from(dailyReports)
    .where(and(...conditions))
    .groupBy(dailyReports.location);

  return { byLocation };
};

const revenueSummary = async ({ dateFrom, dateTo } = {}) => {
  const orderConditions = [eq(orders.paymentStatus, "Paid"), ...dateConditions(orders.createdAt, dateFrom, dateTo)];
  const [orderRevenue] = await db
    .select({ total: sql`COALESCE(SUM(${orders.totalAmount}), 0)`, orderCount: sql`count(*)::int` })
    .from(orders)
    .where(and(...orderConditions));

  const offlineConditions = [eq(offlineSales.status, "approved"), ...dateConditions(offlineSales.createdAt, dateFrom, dateTo)];
  const [offlineRevenue] = await db
    .select({ total: sql`COALESCE(SUM(${offlineSales.totalAmount}), 0)`, saleCount: sql`count(*)::int` })
    .from(offlineSales)
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
