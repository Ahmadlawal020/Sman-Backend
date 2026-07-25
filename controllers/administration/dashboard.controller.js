const asyncHandler = require("express-async-handler");
const { db } = require("../../config/db");
const { trucks, drivers, depots, products } = require("../../db/schema");
const { eq, count, sql } = require("drizzle-orm");

const getStats = asyncHandler(async (req, res) => {
  const [
    [{ totalTrucks }],
    [{ inTransitTrucks }],
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
    db.select({ totalTrucks: count() }).from(trucks),
    db.select({ inTransitTrucks: count() }).from(trucks).where(eq(trucks.status, "In Transit")),
    db.select({ idleTrucks: count() }).from(trucks).where(eq(trucks.status, "Idle")),
    db.select({ maintenanceTrucks: count() }).from(trucks).where(eq(trucks.status, "Maintenance")),
    db.select({ totalDrivers: count() }).from(drivers),
    db.select({ activeDrivers: count() }).from(drivers).where(eq(drivers.status, "Active")),
    db.select({ onTripDrivers: count() }).from(drivers).where(eq(drivers.status, "On Trip")),
    db.select({ offDutyDrivers: count() }).from(drivers).where(eq(drivers.status, "Off Duty")),
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
  const [
    stats,
    recentTrucks,
    recentDrivers,
    recentDepots,
  ] = await Promise.all([
    db
      .select({ status: trucks.status, count: count() })
      .from(trucks)
      .groupBy(trucks.status),
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
