const { eq, and, or, ilike, desc, count } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  lpgStations,
  lpgStationStaff,
  lpgStationCylinders,
  lpgPriceHistory,
  staff,
  pfis,
} = require("../db/schema");

const findById = async (id) => {
  const [row] = await db.select().from(lpgStations).where(eq(lpgStations.id, id)).limit(1);
  return row || null;
};

const findByCode = async (code) => {
  const [row] = await db
    .select()
    .from(lpgStations)
    .where(eq(lpgStations.code, code))
    .limit(1);
  return row || null;
};

const findAll = async ({ search, status, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(lpgStations.name, pattern),
        ilike(lpgStations.code, pattern),
        ilike(lpgStations.city, pattern),
        ilike(lpgStations.state, pattern)
      )
    );
  }

  if (status && status !== "all") {
    conditions.push(eq(lpgStations.status, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(lpgStations)
      .where(whereClause)
      .orderBy(desc(lpgStations.createdAt))
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: count() })
      .from(lpgStations)
      .where(whereClause),
  ]);

  return {
    stations: rows,
    pagination: {
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    },
  };
};

const create = async (data) => {
  const [row] = await db.insert(lpgStations).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const [row] = await db
    .update(lpgStations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(lpgStations.id, id))
    .returning();
  return row || null;
};

const deleteById = async (id) => {
  const [row] = await db.delete(lpgStations).where(eq(lpgStations.id, id)).returning();
  return row || null;
};

// ─── Staff ───────────────────────────────────────────────────────────────────

const getStaff = async (stationId) => {
  const numericStationId = parseInt(stationId, 10) || stationId;
  const rows = await db
    .select({
      id: lpgStationStaff.id,
      adminId: lpgStationStaff.staffId,
      firstName: staff.firstName,
      surname: staff.surname,
      email: staff.email,
    })
    .from(lpgStationStaff)
    .leftJoin(staff, eq(lpgStationStaff.staffId, staff.id))
    .where(eq(lpgStationStaff.lpgStationId, numericStationId));

  return rows.map((r) => ({
    ...r,
    _id: String(r.adminId),
  }));
};

const setStaff = async (stationId, adminIds) => {
  const numericStationId = parseInt(stationId, 10) || stationId;
  await db.delete(lpgStationStaff).where(eq(lpgStationStaff.lpgStationId, numericStationId));
  if (adminIds && adminIds.length > 0) {
    await db
      .insert(lpgStationStaff)
      .values(adminIds.map((adminId) => ({ lpgStationId: numericStationId, staffId: parseInt(adminId, 10) || adminId })));
  }
};

// ─── PFIs ────────────────────────────────────────────────────────────────────

const getPfis = async (stationId) => {
  const numericStationId = parseInt(stationId, 10) || stationId;
  const rows = await db
    .select()
    .from(pfis)
    .where(eq(pfis.lpgStationId, numericStationId))
    .orderBy(desc(pfis.createdAt));
  return rows;
};

// ─── Cylinders ───────────────────────────────────────────────────────────────

const getCylinders = async (stationId) => {
  const numericStationId = parseInt(stationId, 10) || stationId;
  const rows = await db
    .select()
    .from(lpgStationCylinders)
    .where(eq(lpgStationCylinders.lpgStationId, numericStationId))
    .orderBy(lpgStationCylinders.cylinderSizeKg);

  return rows.map((r) => ({
    id: r.id,
    cylinderSizeKg: r.cylinderSizeKg,
    quantity: r.quantity,
  }));
};

const setCylinders = async (stationId, cylinders) => {
  const numericStationId = parseInt(stationId, 10) || stationId;
  await db.delete(lpgStationCylinders).where(eq(lpgStationCylinders.lpgStationId, numericStationId));
  if (cylinders && cylinders.length > 0) {
    await db
      .insert(lpgStationCylinders)
      .values(cylinders.map((c) => ({
        lpgStationId: numericStationId,
        cylinderSizeKg: parseInt(c.cylinderSizeKg, 10) || c.cylinderSizeKg,
        quantity: parseInt(c.quantity, 10) || c.quantity,
      })));
  }
};

const getCylinderStock = async (stationId, cylinderSizeKg) => {
  const numericStationId = parseInt(stationId, 10) || stationId;
  const [row] = await db
    .select()
    .from(lpgStationCylinders)
    .where(
      and(
        eq(lpgStationCylinders.lpgStationId, numericStationId),
        eq(lpgStationCylinders.cylinderSizeKg, cylinderSizeKg)
      )
    )
    .limit(1);
  return row || null;
};

const decrementCylinderQuantity = async (stationId, cylinderSizeKg, amount) => {
  const numericStationId = parseInt(stationId, 10) || stationId;
  const stock = await getCylinderStock(numericStationId, cylinderSizeKg);
  if (!stock) {
    return { success: false, message: "Cylinder stock not found for this station" };
  }
  if (stock.quantity < amount) {
    return { success: false, message: `Insufficient stock. Available: ${stock.quantity}, Requested: ${amount}`, available: stock.quantity };
  }
  const newQuantity = stock.quantity - amount;
  if (newQuantity === 0) {
    await db.delete(lpgStationCylinders).where(eq(lpgStationCylinders.id, stock.id));
  } else {
    await db
      .update(lpgStationCylinders)
      .set({ quantity: newQuantity, updatedAt: new Date() })
      .where(eq(lpgStationCylinders.id, stock.id));
  }
  return { success: true, remaining: newQuantity };
};

// ─── Price History ──────────────────────────────────────────────────────────

const logPriceChange = async (stationId, pricePerKg) => {
  const numericStationId = parseInt(stationId, 10) || stationId;
  await db.insert(lpgPriceHistory).values({
    lpgStationId: numericStationId,
    pricePerKg: String(pricePerKg),
  });
};

const getPriceHistory = async (stationId) => {
  const numericStationId = parseInt(stationId, 10) || stationId;
  const rows = await db
    .select({
      id: lpgPriceHistory.id,
      lpgStationId: lpgPriceHistory.lpgStationId,
      pricePerKg: lpgPriceHistory.pricePerKg,
      setAt: lpgPriceHistory.setAt,
    })
    .from(lpgPriceHistory)
    .where(eq(lpgPriceHistory.lpgStationId, numericStationId))
    .orderBy(desc(lpgPriceHistory.setAt))
    .limit(20);
  return rows;
};

module.exports = {
  findById,
  findByCode,
  findAll,
  create,
  update,
  deleteById,
  getStaff,
  setStaff,
  getPfis,
  getCylinders,
  setCylinders,
  getCylinderStock,
  decrementCylinderQuantity,
  logPriceChange,
  getPriceHistory,
};
