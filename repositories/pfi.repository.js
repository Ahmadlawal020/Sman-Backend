const { eq, and, or, ilike, desc, asc, count, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { consumerPfi, consumerPfimovement, consumerStates, consumerProduct, administrationUser } = require("../db/schema");

/**
 * consumer_pfi is Django's real PFI table — see docs/LIVE_DB_CUTOVER.md §3.
 * Structural differences from the old clean-room `pfis` table this replaces:
 *
 *  - locationId references consumer_states (a region), not a depot — PFIs
 *    are state-scoped live, same as consumer_productprice. There is no
 *    lpgStationId column at all.
 *  - locationName/productName/officer *Name are denormalised display
 *    strings on the old table; live has none of them — join consumerStates/
 *    consumerProduct/administrationUser at read time instead (findById does).
 *  - No soldQtyLitres column. "How much has been drawn down" is not stored —
 *    it's SUM(consumer_pfimovement.qty_litres) for that PFI, an append-only
 *    ledger. reserveStock/releaseStock below are rewritten around that ledger
 *    instead of a running counter, and — because
 *    consumer_pfimovement.order_id is NOT NULL — reserveStock now REQUIRES
 *    an orderId (it didn't before). The unique constraint on
 *    (action, order_id) is what makes a repeated release idempotent, same
 *    intent as the old code's comment about time-of-check/time-of-use races,
 *    enforced one layer down instead of by a WHERE guard on a column.
 *  - unitPrice/totalAmount become pricePerLitre (no stored total — compute
 *    it as startingQtyLitres * pricePerLitre where needed).
 *  - description becomes notes.
 */

const withDisplay = (row) =>
  row && {
    ...row.consumer_pfi,
    locationName: row.consumer_states?.name || "",
    productName: row.consumer_product?.name || "",
  };

const findById = async (id) => {
  const numericId = parseInt(id, 10) || id;
  const [row] = await db
    .select()
    .from(consumerPfi)
    .leftJoin(consumerStates, eq(consumerPfi.locationId, consumerStates.id))
    .leftJoin(consumerProduct, eq(consumerPfi.productId, consumerProduct.id))
    .where(eq(consumerPfi.id, numericId))
    .limit(1);
  return withDisplay(row) || null;
};

const findByNumber = async (pfiNumber) => {
  const [row] = await db.select().from(consumerPfi).where(eq(consumerPfi.pfiNumber, pfiNumber)).limit(1);
  return row || null;
};

const findAll = async ({ search, status, location, page = 1, limit = 100 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(ilike(consumerPfi.pfiNumber, pattern), ilike(consumerPfi.notes, pattern)));
  }
  if (status && status !== "all") conditions.push(eq(consumerPfi.status, status));
  if (location) {
    const numericLocation = parseInt(location, 10) || location;
    conditions.push(eq(consumerPfi.locationId, numericLocation));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(consumerPfi)
      .leftJoin(consumerStates, eq(consumerPfi.locationId, consumerStates.id))
      .leftJoin(consumerProduct, eq(consumerPfi.productId, consumerProduct.id))
      .where(whereClause)
      .orderBy(asc(consumerPfi.status), desc(consumerPfi.createdAt))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(consumerPfi).where(whereClause),
  ]);

  return {
    pfis: rows.map(withDisplay),
    pagination: { total: Number(total), page: pageNum, pages: Math.ceil(Number(total) / limitNum) },
  };
};

const findActiveByLocationAndProduct = async (locationId, productId) => {
  return db
    .select()
    .from(consumerPfi)
    .where(and(eq(consumerPfi.locationId, locationId), eq(consumerPfi.productId, productId), eq(consumerPfi.status, "active")))
    .orderBy(asc(consumerPfi.createdAt));
};

const create = async (data) => {
  const [row] = await db.insert(consumerPfi).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const [row] = await db.update(consumerPfi).set(data).where(eq(consumerPfi.id, id)).returning();
  return row || null;
};

const deleteById = async (id) => {
  const [row] = await db.delete(consumerPfi).where(eq(consumerPfi.id, id)).returning();
  return row || null;
};

/** SUM(consumer_pfimovement.qty_litres) for one PFI — the live "sold" figure. */
const getSoldQty = async (pfiId, tx = db) => {
  const [row] = await tx
    .select({ total: sql`COALESCE(SUM(${consumerPfimovement.qtyLitres}::numeric), 0)::float` })
    .from(consumerPfimovement)
    .where(eq(consumerPfimovement.pfiId, pfiId));
  return Number(row?.total || 0);
};

/**
 * Reserve stock against a PFI for a specific order. Row-locks the PFI first
 * so a concurrent reservation blocks instead of racing — same safety
 * property as the old WHERE-guarded UPDATE, just one layer removed since the
 * running total is now computed, not stored. Must run inside a transaction
 * (pass `tx`); the lock only holds for the transaction's duration.
 *
 * @returns {object|null} the movement row, or null if starting - sold < quantity
 */
const reserveStock = async (pfiId, quantity, orderId, tx) => {
  if (!tx) throw new Error("reserveStock must run inside a db.transaction()");

  const [pfi] = await tx.select().from(consumerPfi).where(eq(consumerPfi.id, pfiId)).for("update").limit(1);
  if (!pfi || pfi.status !== "active") return null;

  const sold = await getSoldQty(pfiId, tx);
  const available = Number(pfi.startingQtyLitres) - sold;
  if (available < Number(quantity)) return null;

  const [row] = await tx
    .insert(consumerPfimovement)
    .values({
      pfiId,
      orderId,
      action: "RELEASE",
      qtyLitres: String(quantity),
      timestamp: new Date().toISOString(),
    })
    .returning();
  return row;
};

/**
 * Reverses a reservation for a cancelled order. Django's PFIMovementAction
 * only defines RELEASE (soroman_backend-2/consumer/models.py) — every
 * PFIMovement.objects.create() call in that codebase uses it, and none ever
 * deletes one, but the unique constraint on (order, action) only allows one
 * RELEASE row per order, so undoing a reservation has to mean removing that
 * row rather than inventing an action value Django doesn't know about.
 */
const releaseStock = async (pfiId, orderId, tx) => {
  if (!tx) throw new Error("releaseStock must run inside a db.transaction()");

  const [deleted] = await tx
    .delete(consumerPfimovement)
    .where(and(eq(consumerPfimovement.pfiId, pfiId), eq(consumerPfimovement.orderId, orderId), eq(consumerPfimovement.action, "RELEASE")))
    .returning();
  if (!deleted) return null;

  const [pfi] = await tx.select().from(consumerPfi).where(eq(consumerPfi.id, pfiId)).limit(1);
  if (pfi?.status === "finished") {
    await tx.update(consumerPfi).set({ status: "active" }).where(eq(consumerPfi.id, pfiId));
  }
  return deleted;
};

const markFinishedIfComplete = async (pfiId, tx = db) => {
  const sold = await getSoldQty(pfiId, tx);
  const [pfi] = await tx.select().from(consumerPfi).where(eq(consumerPfi.id, pfiId)).limit(1);
  if (!pfi || sold < Number(pfi.startingQtyLitres)) return null;

  const [row] = await tx
    .update(consumerPfi)
    .set({ status: "finished", finishedAt: new Date().toISOString() })
    .where(eq(consumerPfi.id, pfiId))
    .returning();
  return row || null;
};

module.exports = {
  findById,
  findByNumber,
  findAll,
  findActiveByLocationAndProduct,
  create,
  update,
  deleteById,
  getSoldQty,
  reserveStock,
  releaseStock,
  markFinishedIfComplete,
};
