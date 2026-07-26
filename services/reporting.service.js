const { eq, and, sql, desc, gte, lte } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  orders,
  deposits,
  customers,
  walletHolds,
  pfis,
  deliveryInventory,
  ledgerAccounts,
  ledgerEntries,
  dailyReports,
  offlineSales,
} = require("../db/schema");
const ledgerService = require("./ledger.service");

// Read-only aggregation, SQL-side. Nothing here writes, and nothing here is
// trusted for money movement — the ledgers and wallet are; these summarise.

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

  const ledger = await ledgerService.summarize({ ownerType: "delivery_customer", dateFrom, dateTo });

  return { byStatus, ledger };
};

const fleetSummary = async ({ dateFrom, dateTo } = {}) => {
  const ledger = await ledgerService.summarize({ ownerType: "fleet_truck", dateFrom, dateTo });

  // Per-truck net position, most costly first.
  const perTruck = await db
    .select({
      accountId: ledgerAccounts.id,
      name: ledgerAccounts.name,
      ownerId: ledgerAccounts.ownerId,
      netCost: ledgerAccounts.runningBalance,
    })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.ownerType, "fleet_truck"))
    .orderBy(desc(ledgerAccounts.runningBalance))
    .limit(50);

  return { ledger, perTruck };
};

const stationSummary = async ({ dateFrom, dateTo } = {}) => {
  return ledgerService.summarize({ ownerType: "filling_station", dateFrom, dateTo });
};

/**
 * Who owes us money, biggest first — across any ledger book.
 */
const outstandingPayments = async ({ ownerType, limit = 50 } = {}) => {
  const conditions = [gte(ledgerAccounts.runningBalance, "0.01")];
  if (ownerType) conditions.push(eq(ledgerAccounts.ownerType, ownerType));

  const accounts = await db
    .select()
    .from(ledgerAccounts)
    .where(and(...conditions))
    .orderBy(desc(ledgerAccounts.runningBalance))
    .limit(Math.min(200, limit));

  const totalOutstanding = accounts.reduce((sum, account) => sum + num(account.runningBalance), 0);
  return { totalOutstanding, accounts };
};

const commissionsSummary = async ({ dateFrom, dateTo } = {}) => {
  const conditions = [eq(ledgerEntries.category, "commission")];
  if (dateFrom) conditions.push(gte(ledgerEntries.entryDate, dateFrom));
  if (dateTo) conditions.push(lte(ledgerEntries.entryDate, dateTo));

  const [totals] = await db
    .select({
      entryCount: sql`count(*)::int`,
      total: sql`COALESCE(SUM(${ledgerEntries.amount}), 0)`,
    })
    .from(ledgerEntries)
    .where(and(...conditions));
  return totals;
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

  return {
    orders: orderRevenue,
    offlineSales: offlineRevenue,
    combined: num(orderRevenue.total) + num(offlineRevenue.total),
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
  commissionsSummary,
  dailyReportSummary,
  revenueSummary,
};
