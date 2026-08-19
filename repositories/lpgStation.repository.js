const { eq, and, or, ilike, desc, count } = require("drizzle-orm");
const { db } = require("../db");
const {
  consumerLpgplant,
  lpgStationExtras,
  lpgStationStaff,
  lpgStationCylinders,
  lpgPriceHistory,
  administrationUser: staff,
} = require("../db/schema");
const { scopeCondition } = require("../lib/scopeFilter");

/**
 * consumer_lpgplant (the live row, canonical) is just name/code/capacity/
 * pricing — address and Paystack subaccount fields live in
 * sman.lpg_station_extras, 1:1 keyed to the live plant (same pattern as
 * depot/depot_extras — see repositories/depot.repository.js). There is no
 * live `status` column, only `is_active`; `status` here maps to that boolean
 * ("Active" <-> true, anything else <-> false) since extras carries no
 * status field of its own.
 */
const lpgStations = consumerLpgplant;

const withExtras = (row) =>
  row && {
    ...row.consumer_lpgplant,
    ...row.lpg_station_extras,
    id: row.consumer_lpgplant.id,
    status: row.consumer_lpgplant.isActive ? "Active" : "Inactive",
  };

const findById = async (id) => {
  const [row] = await db
    .select()
    .from(consumerLpgplant)
    .leftJoin(lpgStationExtras, eq(consumerLpgplant.id, lpgStationExtras.lpgStationId))
    .where(eq(consumerLpgplant.id, id))
    .limit(1);
  return withExtras(row);
};

const findByCode = async (code) => {
  const [row] = await db
    .select()
    .from(consumerLpgplant)
    .leftJoin(lpgStationExtras, eq(consumerLpgplant.id, lpgStationExtras.lpgStationId))
    .where(eq(consumerLpgplant.code, code))
    .limit(1);
  return withExtras(row);
};

const findAll = async ({ search, status, scopeUser, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  // A location-scoped user only sees the LPG stations they're assigned to —
  // same fail-closed rule already applied to /pfis.
  const scope = scopeCondition(scopeUser, { lpgStationColumn: lpgStations.id });
  if (scope) conditions.push(scope);

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(lpgStations.name, pattern),
        ilike(lpgStations.code, pattern),
        ilike(lpgStationExtras.city, pattern),
        ilike(lpgStationExtras.state, pattern)
      )
    );
  }

  if (status && status !== "all") {
    conditions.push(eq(lpgStations.isActive, status === "Active"));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(consumerLpgplant)
      .leftJoin(lpgStationExtras, eq(consumerLpgplant.id, lpgStationExtras.lpgStationId))
      .where(whereClause)
      .orderBy(desc(consumerLpgplant.createdAt))
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: count() })
      .from(consumerLpgplant)
      .leftJoin(lpgStationExtras, eq(consumerLpgplant.id, lpgStationExtras.lpgStationId))
      .where(whereClause),
  ]);

  return {
    stations: rows.map(withExtras),
    pagination: {
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    },
  };
};

const EXTRAS_FIELDS = [
  "address",
  "city",
  "state",
  "country",
  "postcode",
  "establishedYear",
  "paystackSubaccountCode",
  "subaccountActive",
  "subaccountSplitPercentage",
];

const create = async (data, tx = db) => {
  const { status, ...rest } = data;
  const liveData = {};
  const extrasData = {};
  for (const [key, value] of Object.entries(rest)) {
    (EXTRAS_FIELDS.includes(key) ? extrasData : liveData)[key] = value;
  }
  if (status !== undefined) liveData.isActive = status === "Active";

  const [stationRow] = await tx.insert(consumerLpgplant).values(liveData).returning();
  const [extrasRow] = await tx
    .insert(lpgStationExtras)
    .values({ lpgStationId: stationRow.id, ...extrasData })
    .returning();
  return { ...stationRow, ...extrasRow, id: stationRow.id, status: stationRow.isActive ? "Active" : "Inactive" };
};

const update = async (id, data, tx = db) => {
  const { status, ...rest } = data;
  const liveData = {};
  const extrasData = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    (EXTRAS_FIELDS.includes(key) ? extrasData : liveData)[key] = value;
  }
  if (status !== undefined) liveData.isActive = status === "Active";

  if (Object.keys(liveData).length > 0) {
    await tx.update(consumerLpgplant).set(liveData).where(eq(consumerLpgplant.id, id));
  }
  if (Object.keys(extrasData).length > 0) {
    // upsert: a station predating lpg_station_extras has no row there yet —
    // a plain UPDATE would silently affect 0 rows.
    await tx
      .insert(lpgStationExtras)
      .values({ lpgStationId: id, ...extrasData })
      .onConflictDoUpdate({
        target: lpgStationExtras.lpgStationId,
        set: { ...extrasData, updatedAt: new Date() },
      });
  }
  return findById(id);
};

const deleteById = async (id) => {
  const [row] = await db.delete(consumerLpgplant).where(eq(consumerLpgplant.id, id)).returning();
  return row || null;
};

// ─── Staff ───────────────────────────────────────────────────────────────────

const getStaff = async (stationId) => {
  const numericStationId = parseInt(stationId, 10) || stationId;
  const rows = await db
    .select({
      id: lpgStationStaff.id,
      adminId: lpgStationStaff.staffId,
      fullName: staff.fullName,
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

const getPfis = async () => {
  return [];
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

/**
 * Return cylinders to a station's stock — the inverse of the decrement done at
 * approval. If the row was deleted when it hit zero, recreate it.
 */
const incrementCylinderQuantity = async (stationId, cylinderSizeKg, amount) => {
  const numericStationId = parseInt(stationId, 10) || stationId;
  const stock = await getCylinderStock(numericStationId, cylinderSizeKg);
  if (stock) {
    const newQuantity = stock.quantity + Number(amount);
    await db
      .update(lpgStationCylinders)
      .set({ quantity: newQuantity, updatedAt: new Date() })
      .where(eq(lpgStationCylinders.id, stock.id));
    return { success: true, remaining: newQuantity };
  }
  await db.insert(lpgStationCylinders).values({
    lpgStationId: numericStationId,
    cylinderSizeKg,
    quantity: Number(amount),
  });
  return { success: true, remaining: Number(amount) };
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

// paystackSubaccountCode/subaccountActive/subaccountSplitPercentage all live
// on lpg_station_extras now, not the live table — route through update() so
// they land in the right place.
const updateSubaccountFields = (id, data) => update(id, data);

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
  incrementCylinderQuantity,
  logPriceChange,
  getPriceHistory,
  updateSubaccountFields,
};
