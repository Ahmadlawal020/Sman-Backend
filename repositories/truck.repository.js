const { eq, and, or, ilike, desc, count } = require("drizzle-orm");
const { db } = require("../config/db");
const { consumerFleettruck, truckExtras, drivers, driverTruckHistory } = require("../db/schema");

/**
 * consumer_fleettruck (the live row, canonical) covers plate/driver-name/
 * driver-phone/capacity/status/mileage/insurance/road-worthiness/service-date
 * — everything else (vin, year, a separate truck type, live fuel level,
 * registration expiry, mileage-based next-service) lives in sman.truck_extras,
 * 1:1 keyed to the live truck. See db/schema/sman/truckExtras.js.
 *
 * The driver's name/phone are denormalised directly onto the truck row in
 * the live schema (no driver_id FK at all) — sman.drivers is a separate
 * roster (license, rating, safety score) that references a truck back via
 * `assignedTruckId`, not the other way around, so "the assigned driver's
 * roster record" is a reverse lookup, not a join off this table.
 */
const withExtras = (row) =>
  row && {
    ...row.consumer_fleettruck,
    ...row.truck_extras,
    id: row.consumer_fleettruck.id,
  };

const findById = async (id) => {
  const [row] = await db
    .select()
    .from(consumerFleettruck)
    .leftJoin(truckExtras, eq(consumerFleettruck.id, truckExtras.truckId))
    .where(eq(consumerFleettruck.id, id))
    .limit(1);
  return withExtras(row);
};

const findByIdWithDriver = async (id) => {
  const truck = await findById(id);
  if (!truck) return null;

  const [assignedDriver] = await db
    .select({
      driverId: drivers.id,
      driverLicense: drivers.licenseNumber,
    })
    .from(drivers)
    .where(eq(drivers.assignedTruckId, id))
    .limit(1);

  return {
    id: truck.id,
    plateNumber: truck.plateNumber,
    capacity: truck.maxCapacity,
    status: truck.truckStatus,
    currentDriverId: assignedDriver?.driverId ?? null,
    driverLicense: assignedDriver?.driverLicense ?? "",
    mileage: truck.mileage,
    vin: truck.vin,
    year: truck.year,
    make: truck.truckMake,
    type: truck.truckType,
    fuelLevel: truck.fuelLevel,
    insuranceExpiry: truck.insuranceExpiry,
    registrationExpiry: truck.registrationExpiry,
    nextServiceMileage: truck.nextServiceMileage,
    createdAt: truck.createdAt,
    updatedAt: truck.updatedAt,
    driverName: truck.driverName,
    driverPhone: truck.driverPhone,
  };
};

const findByPlateNumber = async (plateNumber) => {
  const [row] = await db
    .select()
    .from(consumerFleettruck)
    .leftJoin(truckExtras, eq(consumerFleettruck.id, truckExtras.truckId))
    .where(eq(consumerFleettruck.plateNumber, plateNumber.toUpperCase()))
    .limit(1);
  return withExtras(row);
};

const findAll = async ({ search, status, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(ilike(consumerFleettruck.plateNumber, pattern), ilike(consumerFleettruck.truckMake, pattern)));
  }

  if (status && status !== "all") {
    conditions.push(eq(consumerFleettruck.truckStatus, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(consumerFleettruck)
      .leftJoin(truckExtras, eq(consumerFleettruck.id, truckExtras.truckId))
      .where(whereClause)
      .orderBy(desc(consumerFleettruck.createdAt))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(consumerFleettruck).where(whereClause),
  ]);

  return {
    trucks: rows.map(withExtras),
    pagination: {
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    },
  };
};

const create = async (data, tx = db) => {
  const { vin, year, type, fuelLevel, registrationExpiry, nextServiceMileage, ...liveData } = data;
  const [truckRow] = await tx.insert(consumerFleettruck).values(liveData).returning();
  const [extrasRow] = await tx
    .insert(truckExtras)
    .values({ truckId: truckRow.id, vin, year, truckType: type, fuelLevel, registrationExpiry, nextServiceMileage })
    .returning();
  return { ...truckRow, ...extrasRow, id: truckRow.id };
};

const update = async (id, data, tx = db) => {
  const { vin, year, type, fuelLevel, registrationExpiry, nextServiceMileage, ...liveData } = data;
  const extrasData = { vin, year, truckType: type, fuelLevel, registrationExpiry, nextServiceMileage };
  for (const key of Object.keys(extrasData)) {
    if (extrasData[key] === undefined) delete extrasData[key];
  }

  if (Object.keys(liveData).length > 0) {
    await tx.update(consumerFleettruck).set(liveData).where(eq(consumerFleettruck.id, id));
  }
  if (Object.keys(extrasData).length > 0) {
    // upsert: a truck predating truck_extras has no row there yet — a plain
    // UPDATE would silently affect 0 rows.
    await tx
      .insert(truckExtras)
      .values({ truckId: id, ...extrasData })
      .onConflictDoUpdate({
        target: truckExtras.truckId,
        set: { ...extrasData, updatedAt: new Date() },
      });
  }
  return findById(id);
};

const deleteById = async (id) => {
  const [row] = await db.delete(consumerFleettruck).where(eq(consumerFleettruck.id, id)).returning();
  return row || null;
};

/**
 * Every driver ever assigned to this truck, most recent first — sourced from
 * sman.driver_truck_history (Sman-Backend-owned; the live schema keeps no
 * assignment history, only the truck's current driver_name/driver_phone).
 */
const getDriverHistory = async (truckId) => {
  return db
    .select({
      id: driverTruckHistory.id,
      driverId: driverTruckHistory.driverId,
      driverName: drivers.name,
      assignedAt: driverTruckHistory.assignedAt,
    })
    .from(driverTruckHistory)
    .leftJoin(drivers, eq(driverTruckHistory.driverId, drivers.id))
    .where(eq(driverTruckHistory.truckId, truckId))
    .orderBy(desc(driverTruckHistory.assignedAt));
};

const addDriverHistory = async (truckId, driverId) => {
  const [row] = await db.insert(driverTruckHistory).values({ truckId, driverId }).returning();
  return row;
};

module.exports = {
  findById,
  findByIdWithDriver,
  findByPlateNumber,
  findAll,
  create,
  update,
  deleteById,
  getDriverHistory,
  addDriverHistory,
};
