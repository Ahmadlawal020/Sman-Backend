const asyncHandler = require("express-async-handler");
const { db } = require("../../config/db");
const {
  fleetTrucks: trucks,
  drivers,
  depots,
  products,
  orders,
  customers,
  deposits,
  offlineSales,
  deliverySales,
  deliveryCustomers,
  auditEvents,
  walletHolds,
  dangoteOrderRequests,
  lpgOrderRequests,
  lpgStations,
} = require("../../db/schema");
const { eq, and, not, count, sql, gte, lte, desc } = require("drizzle-orm");
const {
  revenueSummary,
  salesSummary,
  walletSummary,
  pfiSummary,
  outstandingPayments,
} = require("../../services/reporting.service");

const NEEDS_ATTENTION = sql`(${trucks.truckStatus} ILIKE 'Fair%' OR ${trucks.truckStatus} ILIKE 'Bad%')`;

const num = (v) => Number(v || 0);

function getPeriodDates(period) {
  const now = new Date();
  let from;
  let label;
  switch (period) {
    case "today":
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      label = "Today";
      break;
    case "week":
      from = new Date(now);
      from.setDate(from.getDate() - 7);
      label = "This Week";
      break;
    case "year":
      from = new Date(now.getFullYear(), 0, 1);
      label = "This Year";
      break;
    case "month":
    default:
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      label = "This Month";
      break;
  }
  return { from: from.toISOString(), to: now.toISOString(), label };
}

async function getDailyRevenueTrend(dateFrom, dateTo) {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);

  const [paidOrders, approvedOffline, deliveryRows] = await Promise.all([
    db
      .select({
        date: sql`DATE(${orders.createdAt})`.mapWith(String),
        total: sql`COALESCE(SUM(${orders.totalAmount}), 0)`.mapWith(Number),
      })
      .from(orders)
      .where(
        and(
          eq(orders.paymentStatus, "Paid"),
          gte(orders.createdAt, from),
          lte(orders.createdAt, to)
        )
      )
      .groupBy(sql`DATE(${orders.createdAt})`),

    db
      .select({
        date: sql`DATE(${offlineSales.createdAt})`.mapWith(String),
        total: sql`COALESCE(SUM(${offlineSales.totalAmount}), 0)`.mapWith(Number),
      })
      .from(offlineSales)
      .where(
        and(
          eq(offlineSales.status, "approved"),
          gte(offlineSales.createdAt, from),
          lte(offlineSales.createdAt, to)
        )
      )
      .groupBy(sql`DATE(${offlineSales.createdAt})`),

    db
      .select({
        date: sql`${deliverySales.dateLoaded}`.mapWith(String),
        total: sql`COALESCE(SUM(${deliverySales.paymentAmount}), 0)`.mapWith(Number),
      })
      .from(deliverySales)
      .where(
        and(
          gte(deliverySales.dateLoaded, dateFrom.slice(0, 10)),
          lte(deliverySales.dateLoaded, dateTo.slice(0, 10))
        )
      )
      .groupBy(deliverySales.dateLoaded),
  ]);

  const byDay = new Map();
  for (const r of paidOrders) {
    const key = String(r.date);
    if (!byDay.has(key)) byDay.set(key, { orders: 0, offline: 0, delivery: 0 });
    byDay.get(key).orders = num(r.total);
  }
  for (const r of approvedOffline) {
    const key = String(r.date);
    if (!byDay.has(key)) byDay.set(key, { orders: 0, offline: 0, delivery: 0 });
    byDay.get(key).offline = num(r.total);
  }
  for (const r of deliveryRows) {
    const key = String(r.date);
    if (!byDay.has(key)) byDay.set(key, { orders: 0, offline: 0, delivery: 0 });
    byDay.get(key).delivery = num(r.total);
  }

  const trend = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    const key = cursor.toISOString().slice(0, 10);
    const row = byDay.get(key) || { orders: 0, offline: 0, delivery: 0 };
    trend.push({ date: key, ...row });
    cursor.setDate(cursor.getDate() + 1);
  }
  return trend;
}

const getStats = asyncHandler(async (req, res) => {
  const inTransitTrucks = 0;

  const [
    [{ totalTrucks }],
    [{ idleTrucks }],
    [{ maintenanceTrucks }],
    [{ totalDrivers }],
    [{ activeDrivers }],
    [{ onTripDrivers }],
    [{ offDutyDrivers }],
    [{ totalDepots }],
    [{ totalProducts }],
    categoryResult,
  ] = await Promise.all([
    db.select({ totalTrucks: count() }).from(trucks).where(eq(trucks.isActive, true)),
    db
      .select({ idleTrucks: count() })
      .from(trucks)
      .where(and(eq(trucks.isActive, true), not(NEEDS_ATTENTION))),
    db
      .select({ maintenanceTrucks: count() })
      .from(trucks)
      .where(and(eq(trucks.isActive, true), NEEDS_ATTENTION)),
    db.select({ totalDrivers: count() }).from(drivers),
    db
      .select({ activeDrivers: count() })
      .from(drivers)
      .where(sql`${drivers.status}::text = 'Active'`),
    db
      .select({ onTripDrivers: count() })
      .from(drivers)
      .where(sql`${drivers.status}::text = 'On Trip'`),
    db
      .select({ offDutyDrivers: count() })
      .from(drivers)
      .where(sql`${drivers.status}::text = 'Off Duty'`),
    db.select({ totalDepots: count() }).from(depots),
    db.select({ totalProducts: count() }).from(products),
    db.select({ count: sql`COUNT(DISTINCT ${products.category})` }).from(products),
  ]);

  res.json({
    success: true,
    data: {
      trucks: {
        total: totalTrucks,
        inTransit: inTransitTrucks,
        idle: idleTrucks,
        maintenance: maintenanceTrucks,
      },
      drivers: {
        total: totalDrivers,
        active: activeDrivers,
        onTrip: onTripDrivers,
        offDuty: offDutyDrivers,
      },
      depots: { total: totalDepots },
      products: { total: totalProducts, categories: Number(categoryResult[0]?.count) || 0 },
    },
  });
});

const getOverview = asyncHandler(async (req, res) => {
  const period = req.query.period || "month";
  const { from, to, label } = getPeriodDates(period);

  const [
    revenue,
    sales,
    wallet,
    pfi,
    outstanding,
    fleetCounts,
    driverCounts,
    customerCounts,
    recentActivity,
    revenueTrend,
    depotLeaderboard,
    dangoteSummary,
    lpgSummary,
  ] = await Promise.all([
    revenueSummary({ dateFrom: from, dateTo: to }),
    salesSummary({ dateFrom: from, dateTo: to }),
    walletSummary({ dateFrom: from, dateTo: to }),
    pfiSummary(),
    outstandingPayments({ limit: 5 }),
    (async () => {
      const [total, idle, maintenance] = await Promise.all([
        db.select({ c: count() }).from(trucks).where(eq(trucks.isActive, true)),
        db
          .select({ c: count() })
          .from(trucks)
          .where(and(eq(trucks.isActive, true), not(NEEDS_ATTENTION))),
        db
          .select({ c: count() })
          .from(trucks)
          .where(and(eq(trucks.isActive, true), NEEDS_ATTENTION)),
      ]);
      return {
        total: total[0].c,
        idle: idle[0].c,
        maintenance: maintenance[0].c,
        inTransit: 0,
      };
    })(),
    (async () => {
      const [total, active, onTrip, offDuty] = await Promise.all([
        db.select({ c: count() }).from(drivers),
        db
          .select({ c: count() })
          .from(drivers)
          .where(sql`${drivers.status}::text = 'Active'`),
        db
          .select({ c: count() })
          .from(drivers)
          .where(sql`${drivers.status}::text = 'On Trip'`),
        db
          .select({ c: count() })
          .from(drivers)
          .where(sql`${drivers.status}::text = 'Off Duty'`),
      ]);
      return {
        total: total[0].c,
        active: active[0].c,
        onTrip: onTrip[0].c,
        offDuty: offDuty[0].c,
      };
    })(),
    (async () => {
      const [total, newThisPeriod] = await Promise.all([
        db.select({ c: count() }).from(customers),
        db
          .select({ c: count() })
          .from(customers)
          .where(gte(customers.createdAt, new Date(from))),
      ]);
      return { total: total[0].c, newThisPeriod: newThisPeriod[0].c };
    })(),
    db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        actorType: auditEvents.actorType,
        actorName: auditEvents.actorName,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(15),
    getDailyRevenueTrend(from, to),

    // Depot leaderboard: orders grouped by depot, ranked by revenue
    (async () => {
      const rows = await db
        .select({
          id: depots.id,
          name: depots.name,
          orderCount: sql`COUNT(${orders.id})::int`.mapWith(Number),
          revenue: sql`COALESCE(SUM(${orders.totalAmount}), 0)`.mapWith(Number),
          volume: sql`COALESCE(SUM(${orders.quantity}), 0)::bigint`.mapWith(Number),
        })
        .from(depots)
        .leftJoin(
          orders,
          and(
            eq(orders.depotId, depots.id),
            eq(orders.paymentStatus, "Paid"),
            gte(orders.createdAt, new Date(from)),
            lte(orders.createdAt, new Date(to))
          )
        )
        .groupBy(depots.id, depots.name)
        .orderBy(desc(sql`COALESCE(SUM(${orders.totalAmount}), 0)`));
      return rows;
    })(),

    // Dangote order requests summary
    (async () => {
      const [totals] = await db
        .select({
          totalRequests: sql`COUNT(*)::int`.mapWith(Number),
          totalValue: sql`COALESCE(SUM(${dangoteOrderRequests.totalAmount}), 0)`.mapWith(Number),
          paidValue: sql`COALESCE(SUM(CASE WHEN ${dangoteOrderRequests.paymentStatus} = 'Paid' THEN ${dangoteOrderRequests.totalAmount} ELSE 0 END), 0)`.mapWith(Number),
        })
        .from(dangoteOrderRequests)
        .where(
          and(
            gte(dangoteOrderRequests.createdAt, new Date(from)),
            lte(dangoteOrderRequests.createdAt, new Date(to))
          )
        );

      const byStatus = await db
        .select({
          status: dangoteOrderRequests.status,
          count: sql`COUNT(*)::int`.mapWith(Number),
          total: sql`COALESCE(SUM(${dangoteOrderRequests.totalAmount}), 0)`.mapWith(Number),
        })
        .from(dangoteOrderRequests)
        .where(
          and(
            gte(dangoteOrderRequests.createdAt, new Date(from)),
            lte(dangoteOrderRequests.createdAt, new Date(to))
          )
        )
        .groupBy(dangoteOrderRequests.status);

      return { ...totals, byStatus };
    })(),

    // LPG orders + stations summary
    (async () => {
      const [orderTotals] = await db
        .select({
          totalOrders: sql`COUNT(*)::int`.mapWith(Number),
          totalValue: sql`COALESCE(SUM(${lpgOrderRequests.totalAmount}), 0)`.mapWith(Number),
          paidValue: sql`COALESCE(SUM(CASE WHEN ${lpgOrderRequests.paymentStatus} = 'Paid' THEN ${lpgOrderRequests.totalAmount} ELSE 0 END), 0)`.mapWith(Number),
        })
        .from(lpgOrderRequests)
        .where(
          and(
            gte(lpgOrderRequests.createdAt, new Date(from)),
            lte(lpgOrderRequests.createdAt, new Date(to))
          )
        );

      const [stationCounts] = await db
        .select({
          total: sql`COUNT(*)::int`.mapWith(Number),
          active: sql`COUNT(*) FILTER (WHERE ${lpgStations.status} = 'Active')::int`.mapWith(Number),
        })
        .from(lpgStations);

      const byStatus = await db
        .select({
          status: lpgOrderRequests.status,
          count: sql`COUNT(*)::int`.mapWith(Number),
          total: sql`COALESCE(SUM(${lpgOrderRequests.totalAmount}), 0)`.mapWith(Number),
        })
        .from(lpgOrderRequests)
        .where(
          and(
            gte(lpgOrderRequests.createdAt, new Date(from)),
            lte(lpgOrderRequests.createdAt, new Date(to))
          )
        )
        .groupBy(lpgOrderRequests.status);

      return { ...orderTotals, stations: stationCounts, byStatus };
    })(),
  ]);

  const orderStatusMap = {};
  for (const row of sales.byStatus) {
    const key = row.status;
    if (!orderStatusMap[key]) orderStatusMap[key] = 0;
    orderStatusMap[key] += row.orderCount;
  }
  const orderStatusBreakdown = Object.entries(orderStatusMap).map(([name, value]) => ({
    name,
    value,
  }));

  res.json({
    success: true,
    data: {
      period: { from, to, label },
      revenue,
      orders: sales,
      wallet,
      pfi,
      outstanding,
      fleet: fleetCounts,
      drivers: driverCounts,
      customers: customerCounts,
      revenueTrend,
      orderStatusBreakdown,
      recentActivity,
      depotLeaderboard,
      dangote: dangoteSummary,
      lpg: lpgSummary,
    },
  });
});

module.exports = { getStats, getOverview };
