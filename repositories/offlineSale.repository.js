const { eq, and, or, ilike, asc, desc, count, gte, lte } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  administrationOfflinesales: offlineSales,
  administrationOfflinesalesproduct: offlineSaleItems,
  consumerProduct: products,
} = require("../db/schema");

/**
 * administration_offlinesales (live, canonical) is much sparser than the old
 * clean-room offline_sales: no sale_number, customer_name, location, or
 * reconciled column, and `total_amount` -> `total_price`. Its line-item
 * table (administration_offlinesalesproduct) tracks quantity only — no
 * per-line unit_price/line_total, so findByIdWithItems can no longer report
 * those; the sale's own total_price is the only money figure left.
 */

// Whitelist, not passthrough: sort input never reaches SQL unvalidated.
const SORTABLE = {
  createdAt: offlineSales.createdAt,
  totalPrice: offlineSales.totalPrice,
  status: offlineSales.status,
};

const findById = async (id) => {
  const [row] = await db.select().from(offlineSales).where(eq(offlineSales.id, id)).limit(1);
  return row || null;
};

const findByIdWithItems = async (id) => {
  const sale = await findById(id);
  if (!sale) return null;
  const items = await db
    .select({
      id: offlineSaleItems.id,
      productId: offlineSaleItems.productId,
      productName: products.name,
      productSku: products.abbreviation,
      quantity: offlineSaleItems.quantity,
    })
    .from(offlineSaleItems)
    .leftJoin(products, eq(offlineSaleItems.productId, products.id))
    .where(eq(offlineSaleItems.offlineId, id));
  return { ...sale, items };
};

const findAll = async ({ status, search, reconciled, dateFrom, dateTo, sort, order, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (status) conditions.push(eq(offlineSales.status, status));
  // No reconciled column on the live table — silently ignored rather than
  // erroring, same treatment as the other dropped clean-room-only fields.
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(ilike(offlineSales.staff, pattern), ilike(offlineSales.notes, pattern)));
  }
  if (dateFrom) conditions.push(gte(offlineSales.createdAt, new Date(dateFrom).toISOString()));
  if (dateTo) conditions.push(lte(offlineSales.createdAt, new Date(dateTo).toISOString()));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(offlineSales)
      .where(whereClause)
      .orderBy(
        (order === "asc" ? asc : desc)(SORTABLE[sort] || offlineSales.createdAt),
        desc(offlineSales.id)
      )
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(offlineSales).where(whereClause),
  ]);

  return {
    sales: rows,
    pagination: { total, page: pageNum, pages: Math.ceil(total / limitNum) },
  };
};

const update = async (id, data) => {
  // updatedAt is timestamp(mode: 'string') — postgres.js rejects a raw Date
  // for a string-mode column.
  const [row] = await db
    .update(offlineSales)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(offlineSales.id, id))
    .returning();
  return row || null;
};

module.exports = { findById, findByIdWithItems, findAll, update };
