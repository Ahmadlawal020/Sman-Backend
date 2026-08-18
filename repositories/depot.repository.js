const { eq, and, or, ilike, desc, asc, count } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  consumerDepots,
  depotExtras,
  depotStaff,
  depotProductCapacities,
  depotPriceHistory,
  consumerProduct,
  consumerProductprice,
  administrationUser,
} = require("../db/schema");

/**
 * consumer_depots is Django's real depot table — just id/name/location, see
 * docs/LIVE_DB_CUTOVER.md §3. Everything else the old `depots` table had
 * (code, address, capacity, status, Paystack subaccount fields) lives in
 * sman.depot_extras, 1:1 keyed to the live depot — findById/findAll below
 * join it in automatically.
 *
 * Product PRICING is a bigger mismatch than a missing column: Django prices
 * (and tracks stock for) a product per STATE via consumer_productprice
 * (unique on product_id+state_id), not per depot — consumer_depots has no
 * state/location FK at all, so there is no live per-depot price. The old
 * getProductPrices(depotId)/upsertProductPrice(depotId, ...) API is dropped;
 * the state-scoped replacements are below. Product CAPACITY (how much of a
 * product a depot can physically hold) is unrelated to price and still maps
 * cleanly to sman.depot_product_capacities.
 */

const withExtras = (row) =>
  row && {
    ...row.consumer_depots,
    ...row.depot_extras,
    id: row.consumer_depots.id, // depotExtras.depotId would otherwise win the spread
  };

const findById = async (id, tx = db) => {
  const [row] = await tx
    .select()
    .from(consumerDepots)
    .leftJoin(depotExtras, eq(depotExtras.depotId, consumerDepots.id))
    .where(eq(consumerDepots.id, id))
    .limit(1);
  return withExtras(row) || null;
};

const findByCode = async (code) => {
  const [row] = await db
    .select()
    .from(consumerDepots)
    .innerJoin(depotExtras, eq(depotExtras.depotId, consumerDepots.id))
    .where(eq(depotExtras.code, code))
    .limit(1);
  return withExtras(row) || null;
};

const findAll = async ({ search, status, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(ilike(consumerDepots.name, pattern), ilike(consumerDepots.location, pattern)));
  }

  if (status && status !== "all") {
    conditions.push(eq(depotExtras.status, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(consumerDepots)
      .leftJoin(depotExtras, eq(depotExtras.depotId, consumerDepots.id))
      .where(whereClause)
      .orderBy(desc(consumerDepots.id), asc(consumerDepots.id))
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: count() })
      .from(consumerDepots)
      .leftJoin(depotExtras, eq(depotExtras.depotId, consumerDepots.id))
      .where(whereClause),
  ]);

  return {
    depots: rows.map(withExtras),
    pagination: {
      total: Number(total),
      page: pageNum,
      pages: Math.ceil(Number(total) / limitNum),
    },
  };
};

const create = async (data, tx = db) => {
  const { code, address, city, state, country, postcode, maxCapacity, status, establishedYear, ...liveData } = data;
  const [depotRow] = await tx.insert(consumerDepots).values(liveData).returning();
  const [extrasRow] = await tx
    .insert(depotExtras)
    .values({ depotId: depotRow.id, code, address, city, state, country, postcode, maxCapacity, status, establishedYear })
    .returning();
  return { ...depotRow, ...extrasRow, id: depotRow.id };
};

const update = async (id, data, tx = db) => {
  const { name, location, ...extrasData } = data;
  const liveData = {};
  if (name !== undefined) liveData.name = name;
  if (location !== undefined) liveData.location = location;

  if (Object.keys(liveData).length > 0) {
    await tx.update(consumerDepots).set(liveData).where(eq(consumerDepots.id, id));
  }
  if (Object.keys(extrasData).length > 0) {
    // upsert: most depots predate depot_extras and have no row there yet —
    // a plain UPDATE would silently affect 0 rows for every one of them.
    await tx
      .insert(depotExtras)
      .values({ depotId: id, ...extrasData })
      .onConflictDoUpdate({
        target: depotExtras.depotId,
        set: { ...extrasData, updatedAt: new Date() },
      });
  }
  return findById(id, tx);
};

const updateSubaccountFields = (id, data) => update(id, data);

const deleteById = async (id) => {
  const [row] = await db.delete(consumerDepots).where(eq(consumerDepots.id, id)).returning();
  return row || null;
};

// ─── Staff ───────────────────────────────────────────────────────────────────

const getStaff = async (depotId) => {
  const numericDepotId = parseInt(depotId, 10) || depotId;
  const rows = await db
    .select({
      id: depotStaff.id,
      adminId: depotStaff.staffId,
      fullName: administrationUser.fullName,
      email: administrationUser.email,
    })
    .from(depotStaff)
    .leftJoin(administrationUser, eq(depotStaff.staffId, administrationUser.id))
    .where(eq(depotStaff.depotId, numericDepotId));

  return rows.map((r) => ({ ...r, _id: String(r.adminId) }));
};

const setStaff = async (depotId, adminIds) => {
  const numericDepotId = parseInt(depotId, 10) || depotId;
  await db.delete(depotStaff).where(eq(depotStaff.depotId, numericDepotId));
  if (adminIds && adminIds.length > 0) {
    await db
      .insert(depotStaff)
      .values(adminIds.map((adminId) => ({ depotId: numericDepotId, staffId: parseInt(adminId, 10) || adminId })));
  }
};

// ─── Product capacities ──────────────────────────────────────────────────────

const getProductCapacities = async (depotId) => {
  const numericDepotId = parseInt(depotId, 10) || depotId;
  const rows = await db
    .select({
      id: depotProductCapacities.id,
      productId: depotProductCapacities.productId,
      capacity: depotProductCapacities.capacity,
      productName: consumerProduct.name,
      productUnit: consumerProduct.unit,
    })
    .from(depotProductCapacities)
    .leftJoin(consumerProduct, eq(depotProductCapacities.productId, consumerProduct.id))
    .where(eq(depotProductCapacities.depotId, numericDepotId));

  return rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    capacity: r.capacity,
    productName: r.productName,
    product: {
      id: String(r.productId),
      name: r.productName || "Unknown Product",
      unit: r.productUnit || "Liters",
    },
  }));
};

const upsertProductCapacity = async (depotId, productId, capacity) => {
  const numericDepotId = parseInt(depotId, 10) || depotId;
  const numericProductId = parseInt(productId, 10) || productId;
  const [existing] = await db
    .select()
    .from(depotProductCapacities)
    .where(and(eq(depotProductCapacities.depotId, numericDepotId), eq(depotProductCapacities.productId, numericProductId)))
    .limit(1);

  if (existing) {
    const [row] = await db
      .update(depotProductCapacities)
      .set({ capacity, updatedAt: new Date() })
      .where(eq(depotProductCapacities.id, existing.id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(depotProductCapacities)
    .values({ depotId: numericDepotId, productId: numericProductId, capacity })
    .returning();
  return row;
};

const setProductCapacities = async (depotId, capacitiesList) => {
  const numericDepotId = parseInt(depotId, 10) || depotId;
  if (!Array.isArray(capacitiesList)) return;

  const validProductIds = capacitiesList.map((pc) => parseInt(pc.product, 10) || pc.product);
  const existingCapacities = await db.select().from(depotProductCapacities).where(eq(depotProductCapacities.depotId, numericDepotId));

  for (const existing of existingCapacities) {
    if (!validProductIds.includes(existing.productId)) {
      await db.delete(depotProductCapacities).where(eq(depotProductCapacities.id, existing.id));
    }
  }
  for (const pc of capacitiesList) {
    await upsertProductCapacity(numericDepotId, pc.product, pc.capacity);
  }
};

// ─── Product prices — state-scoped on the live schema, not depot-scoped ─────

const getProductPricesByState = async (stateId) => {
  const rows = await db
    .select({
      id: consumerProductprice.id,
      productId: consumerProductprice.productId,
      price: consumerProductprice.price,
      stockQuantity: consumerProductprice.stockQuantity,
      productName: consumerProduct.name,
      productUnit: consumerProduct.unit,
    })
    .from(consumerProductprice)
    .leftJoin(consumerProduct, eq(consumerProductprice.productId, consumerProduct.id))
    .where(eq(consumerProductprice.stateId, stateId));

  return rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    currentPrice: parseFloat(r.price),
    stockQuantity: r.stockQuantity,
    productName: r.productName,
    product: { id: String(r.productId), name: r.productName || "Unknown Product", unit: r.productUnit || "Liters" },
  }));
};

const getProductPrice = async (stateId, productId, tx = db) => {
  const [row] = await tx
    .select()
    .from(consumerProductprice)
    .where(and(eq(consumerProductprice.stateId, stateId), eq(consumerProductprice.productId, productId)))
    .limit(1);
  return row || null;
};

const upsertProductPrice = async (stateId, productId, price) => {
  const existing = await getProductPrice(stateId, productId);

  if (existing) {
    const [row] = await db
      .update(consumerProductprice)
      .set({ price: String(price), updatedAt: new Date().toISOString() })
      .where(eq(consumerProductprice.id, existing.id))
      .returning();
    await db.insert(depotPriceHistory).values({ depotProductPriceId: existing.id, price: String(price) });
    return row;
  }

  const [row] = await db
    .insert(consumerProductprice)
    .values({
      stateId,
      productId,
      price: String(price),
      initialStockQuantity: 0,
      stockQuantity: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .returning();
  await db.insert(depotPriceHistory).values({ depotProductPriceId: row.id, price: String(price) });
  return row;
};

const getPriceHistory = async (depotProductPriceId) => {
  return db
    .select()
    .from(depotPriceHistory)
    .where(eq(depotPriceHistory.depotProductPriceId, depotProductPriceId))
    .orderBy(desc(depotPriceHistory.setAt));
};

module.exports = {
  findById,
  findByCode,
  findAll,
  create,
  update,
  updateSubaccountFields,
  deleteById,
  getStaff,
  setStaff,
  getProductCapacities,
  setProductCapacities,
  upsertProductCapacity,
  getProductPricesByState,
  getProductPrice,
  upsertProductPrice,
  getPriceHistory,
};
