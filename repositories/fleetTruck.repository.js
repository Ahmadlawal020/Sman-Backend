const { eq, and, or, ilike, desc, asc, count, lte, gte } = require("drizzle-orm");
const { db } = require("../config/db");
const { fleetTrucks, fleetTrips } = require("../db/schema");

const findById = async (id) => {
  const [row] = await db.select().from(fleetTrucks).where(eq(fleetTrucks.id, id)).limit(1);
  return row || null;
};

const findByPlate = async (plateNumber) => {
  const [row] = await db
    .select()
    .from(fleetTrucks)
    .where(eq(fleetTrucks.plateNumber, plateNumber))
    .limit(1);
  return row || null;
};

// Whitelist, not passthrough: sort input never reaches SQL unvalidated.
const SORTABLE = {
  plateNumber: fleetTrucks.plateNumber,
  createdAt: fleetTrucks.createdAt,
  mileage: fleetTrucks.mileage,
  nextServiceDate: fleetTrucks.nextServiceDate,
};

const findAll = async ({ search, isActive, sort, order, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(fleetTrucks.plateNumber, pattern),
        ilike(fleetTrucks.driverName, pattern),
        ilike(fleetTrucks.truckMake, pattern)
      )
    );
  }
  if (isActive !== undefined) conditions.push(eq(fleetTrucks.isActive, isActive));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const sortColumn = SORTABLE[sort] || fleetTrucks.plateNumber;
  const sortDir = order === "desc" ? desc : asc;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(fleetTrucks)
      .where(whereClause)
      .orderBy(sortDir(sortColumn), asc(fleetTrucks.id))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(fleetTrucks).where(whereClause),
  ]);

  return {
    trucks: rows,
    pagination: { total, page: pageNum, pages: Math.ceil(total / limitNum) },
  };
};

const create = async (data) => {
  const [row] = await db.insert(fleetTrucks).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const [row] = await db
    .update(fleetTrucks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(fleetTrucks.id, id))
    .returning();
  return row || null;
};

// Compliance watchlist: anything expiring on or before the given date.
const findExpiringCompliance = async (byDate) => {
  return db
    .select()
    .from(fleetTrucks)
    .where(
      and(
        eq(fleetTrucks.isActive, true),
        or(
          lte(fleetTrucks.insuranceExpiry, byDate),
          lte(fleetTrucks.roadWorthinessExpiry, byDate),
          lte(fleetTrucks.nextServiceDate, byDate)
        )
      )
    )
    .orderBy(asc(fleetTrucks.plateNumber));
};

// ── Trips ────────────────────────────────────────────────────────────────────

const createTrip = async (data) => {
  const [row] = await db.insert(fleetTrips).values(data).returning();
  return row;
};

const findTrips = async ({ fleetTruckId, dateFrom, dateTo, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (fleetTruckId) conditions.push(eq(fleetTrips.fleetTruckId, fleetTruckId));
  if (dateFrom) conditions.push(gte(fleetTrips.tripDate, dateFrom));
  if (dateTo) conditions.push(lte(fleetTrips.tripDate, dateTo));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(fleetTrips)
      .where(whereClause)
      .orderBy(desc(fleetTrips.tripDate), desc(fleetTrips.id))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(fleetTrips).where(whereClause),
  ]);

  return {
    trips: rows,
    pagination: { total, page: pageNum, pages: Math.ceil(total / limitNum) },
  };
};

module.exports = {
  findById,
  findByPlate,
  findAll,
  create,
  update,
  findExpiringCompliance,
  createTrip,
  findTrips,
};
