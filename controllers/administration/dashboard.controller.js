const asyncHandler = require("express-async-handler");
const { db } = require("../../config/db");
const { fleetTrucks: trucks, drivers, depots, products } = require("../../db/schema");

/*
 * The truck registry is fleet_trucks now. It has no operational status column
 * — the old table's "In Transit" / "Idle" / "Maintenance" does not exist here.
 * What it does have is `isActive` and a condition rating packed into
 * `truckStatus` ("Fair — worn tyres"), so the buckets below are derived from
 * condition rather than invented.
 */
const { eq, and, not, count, sql } = require("drizzle-orm");

const NEEDS_ATTENTION = sql`(${trucks.truckStatus} ILIKE 'Fair%' OR ${trucks.truckStatus} ILIKE 'Bad%')`;

const getStats = asyncHandler(async (req, res) => {
  // Nothing tracks a truck being on the road, so this stays zero rather than
  // being derived from something that only looks like movement.
  const inTransitTrucks = 0

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
    db.select({ idleTrucks: count() }).from(trucks).where(and(eq(trucks.isActive, true), not(NEEDS_ATTENTION))),
    db.select({ maintenanceTrucks: count() }).from(trucks).where(and(eq(trucks.isActive, true), NEEDS_ATTENTION)),
    db.select({ totalDrivers: count() }).from(drivers),
    db.select({ activeDrivers: count() }).from(drivers).where(sql`${drivers.status}::text = 'Active'`),
    db.select({ onTripDrivers: count() }).from(drivers).where(sql`${drivers.status}::text = 'On Trip'`),
    db.select({ offDutyDrivers: count() }).from(drivers).where(sql`${drivers.status}::text = 'Off Duty'`),
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
      depots: {
        total: totalDepots,
      },
      products: {
        total: totalProducts,
        categories: Number(categoryResult[0]?.count) || 0,
      },
    },
  });
});

const getOverview = asyncHandler(async (req, res) => {
  // Nothing tracks a truck being on the road, so this stays zero rather than
  // being derived from something that only looks like movement.
  const inTransitTrucks = 0

  const [
    stats,
    recentTrucks,
    recentDrivers,
    recentDepots,
  ] = await Promise.all([
    db
      .select({ status: trucks.truckStatus, count: count() })
      .from(trucks)
      .groupBy(trucks.truckStatus),
    db
      .select({
        id: trucks.id,
        plateNumber: trucks.plateNumber,
        model: trucks.model,
        status: trucks.status,
        fuelLevel: trucks.fuelLevel,
        createdAt: trucks.createdAt,
      })
      .from(trucks)
      .orderBy(sql`${trucks.createdAt} DESC`)
      .limit(5),
    db
      .select({
        id: drivers.id,
        name: drivers.name,
        status: drivers.status,
        safetyScore: drivers.safetyScore,
        createdAt: drivers.createdAt,
      })
      .from(drivers)
      .orderBy(sql`${drivers.createdAt} DESC`)
      .limit(5),
    db
      .select({
        id: depots.id,
        name: depots.name,
        status: depots.status,
        parkedTrucksCount: depots.parkedTrucksCount,
        maxCapacity: depots.maxCapacity,
        createdAt: depots.createdAt,
      })
      .from(depots)
      .orderBy(sql`${depots.createdAt} DESC`)
      .limit(5),
  ]);

  res.json({
    success: true,
    data: {
      truckStatusBreakdown: stats,
      recentTrucks,
      recentDrivers,
      recentDepots,
    },
  });
});

module.exports = { getStats, getOverview };
