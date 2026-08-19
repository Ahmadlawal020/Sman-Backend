const asyncHandler = require("express-async-handler");
const { db } = require("../../config/db");
const {
  consumerFleettruck: trucks,
  drivers,
  consumerDepots: depots,
  depotExtras,
  consumerProduct: products,
  consumerOrder: orders,
  consumerCustomer: customers,
  consumerOrderpaymentrecord: deposits,
  administrationOfflinesales: offlineSales,
  administrationDeliverysale: deliverySales,
  administrationDeliverycustomer: deliveryCustomers,
  auditEvents,
  walletHolds,
  dangoteOrderRequests,
  lpgOrderRequests,
  consumerLpgplant: lpgStations,
  consumerStates,
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
  // orders.createdAt / offlineSales.createdAt are mode:'string' timestamp
  // columns — need ISO strings, not raw Date instances (see reporting.service.js's
  // dateConditions for the same rule). deliverySales.dateLoaded is a DATE
  // column — needs a plain YYYY-MM-DD string, which is why it's sliced below
  // instead of passed as an ISO datetime.
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const fromDateOnly = fromIso.slice(0, 10);
  const toDateOnly = toIso.slice(0, 10);

  const [paidOrders, approvedOffline, deliveryRows] = await Promise.all([
    db
      .select({
        date: sql`DATE(${orders.createdAt})`.mapWith(String),
        // consumer_order has no paymentStatus/totalAmount columns — status
        // is the real column, and "Paid" is Sman vocabulary computed from it
        // (see utils/orderStatusMapping.js); totalPrice is the real amount column.
        total: sql`COALESCE(SUM(${orders.totalPrice}::numeric), 0)`.mapWith(Number),
      })
      .from(orders)
      .where(
        and(
          sql`${orders.status} IN ('paid', 'released', 'loaded')`,
          gte(orders.createdAt, fromIso),
          lte(orders.createdAt, toIso)
        )
      )
      .groupBy(sql`DATE(${orders.createdAt})`),

    db
      .select({
        date: sql`DATE(${offlineSales.createdAt})`.mapWith(String),
        total: sql`COALESCE(SUM(${offlineSales.totalPrice}::numeric), 0)`.mapWith(Number),
      })
      .from(offlineSales)
      .where(
        and(
          eq(offlineSales.status, "approved"),
          gte(offlineSales.createdAt, fromIso),
          lte(offlineSales.createdAt, toIso)
        )
      )
      .groupBy(sql`DATE(${offlineSales.createdAt})`),

    db
      .select({
        date: sql`${deliverySales.dateLoaded}`.mapWith(String),
        total: sql`COALESCE(SUM(${deliverySales.paymentAmount}::numeric), 0)`.mapWith(Number),
      })
      .from(deliverySales)
      .where(
        and(
          gte(deliverySales.dateLoaded, fromDateOnly),
          lte(deliverySales.dateLoaded, toDateOnly)
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
    // consumer_product has no category column — interpolating the missing
    // column produced `COUNT(DISTINCT )`, a syntax error that 500'd the whole
    // stats endpoint. The trade code (abbreviation: PMS/AGO/LPG) is the
    // closest live analogue of a product category.
    db.select({ count: sql`COUNT(DISTINCT ${products.abbreviation})` }).from(products),
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
          .where(gte(customers.createdAt, new Date(from).toISOString())),
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

    // Leaderboard: orders grouped by state, ranked by revenue. Was written
    // against a depotId column consumer_order has never had on the live
    // schema (see repositories/order.repository.js's header comment) — no
    // depot is tracked on an order at all, only a state (via stateId) and a
    // PFI. Rebuilt around state, the grouping orders actually support; a
    // real depot-level breakdown would need the gate/ticketing rework this
    // codebase already has flagged as a separate, larger piece of work.
    (async () => {
      const rows = await db
        .select({
          id: consumerStates.id,
          name: consumerStates.name,
          orderCount: sql`COUNT(${orders.id})::int`.mapWith(Number),
          revenue: sql`COALESCE(SUM(${orders.totalPrice}::numeric), 0)`.mapWith(Number),
          volume: sql`COALESCE(SUM(${orders.quantity}), 0)::bigint`.mapWith(Number),
        })
        .from(consumerStates)
        .leftJoin(
          orders,
          and(
            eq(orders.stateId, consumerStates.id),
            sql`${orders.status} IN ('paid', 'released', 'loaded')`,
            gte(orders.createdAt, new Date(from).toISOString()),
            lte(orders.createdAt, new Date(to).toISOString())
          )
        )
        .groupBy(consumerStates.id, consumerStates.name)
        .orderBy(desc(sql`COALESCE(SUM(${orders.totalPrice}::numeric), 0)`));
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

      // consumer_lpgplant has no status column — isActive (boolean) is the
      // real live field.
      const [stationCounts] = await db
        .select({
          total: sql`COUNT(*)::int`.mapWith(Number),
          active: sql`COUNT(*) FILTER (WHERE ${lpgStations.isActive} = true)::int`.mapWith(Number),
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
