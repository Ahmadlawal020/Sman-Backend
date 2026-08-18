const { eq, and, or, ilike, desc, count } = require("drizzle-orm");
const { db } = require("../config/db");
const { consumerProduct } = require("../db/schema");

/**
 * consumer_product is Django's real product table (10 columns) — see
 * docs/LIVE_DB_CUTOVER.md §3. Gaps from the old clean-room `products` table:
 * no sku, category, product_type, grade_class, density, flash_point,
 * un_number, hazard_class, or supplier — the hazmat/SKU classification
 * fields have no live backing at all. Live adds `is_deleted` (soft delete)
 * and `initial_stock_quantity`, which the old table didn't have.
 */

const findById = async (id, { includeDeleted = false } = {}) => {
  const conditions = [eq(consumerProduct.id, id)];
  if (!includeDeleted) conditions.push(eq(consumerProduct.isDeleted, false));
  const [row] = await db
    .select()
    .from(consumerProduct)
    .where(and(...conditions))
    .limit(1);
  return row || null;
};

const findAll = async ({ search, page = 1, limit = 50, includeDeleted = false } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (!includeDeleted) conditions.push(eq(consumerProduct.isDeleted, false));

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(ilike(consumerProduct.name, pattern), ilike(consumerProduct.abbreviation, pattern)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(consumerProduct)
      .where(whereClause)
      .orderBy(desc(consumerProduct.createdAt))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(consumerProduct).where(whereClause),
  ]);

  return {
    products: rows,
    pagination: {
      total: Number(total),
      page: pageNum,
      pages: Math.ceil(Number(total) / limitNum),
    },
  };
};

const create = async (data) => {
  const [row] = await db.insert(consumerProduct).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const [row] = await db.update(consumerProduct).set(data).where(eq(consumerProduct.id, id)).returning();
  return row || null;
};

// Django models this as is_deleted, not a row removal — matches that instead
// of hard-deleting a row other systems (Django, order history) still expect
// to find by id.
const softDelete = async (id) => {
  const [row] = await db
    .update(consumerProduct)
    .set({ isDeleted: true })
    .where(eq(consumerProduct.id, id))
    .returning();
  return row || null;
};

module.exports = {
  findById,
  findAll,
  create,
  update,
  softDelete,
};
