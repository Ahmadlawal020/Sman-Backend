const { eq, and, or, ilike, desc, asc, sql, count, ne, isNull, isNotNull } = require("drizzle-orm");
const { db } = require("../config/db");
const { admins } = require("../db/schema");
const bcrypt = require("bcrypt");

const findById = async (id) => {
  const numericId = parseInt(id, 10);
  const targetId = isNaN(numericId) ? id : numericId;
  const [row] = await db.select().from(admins).where(eq(admins.id, targetId)).limit(1);
  return row || null;
};

const findByEmail = async (email) => {
  const [row] = await db
    .select()
    .from(admins)
    .where(eq(admins.email, email.toLowerCase()))
    .limit(1);
  return row || null;
};

const findByRefreshToken = async (token) => {
  const [row] = await db
    .select()
    .from(admins)
    .where(eq(admins.refreshToken, token))
    .limit(1);
  return row || null;
};

const findByPasswordResetToken = async (hashedToken) => {
  const [row] = await db
    .select()
    .from(admins)
    .where(
      and(
        eq(admins.passwordResetToken, hashedToken),
        sql`${admins.passwordResetExpires} > NOW()`
      )
    )
    .limit(1);
  return row || null;
};

const findAll = async ({ search, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(admins.firstName, pattern),
        ilike(admins.surname, pattern),
        ilike(admins.email, pattern)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(admins)
      .where(whereClause)
      .orderBy(desc(admins.createdAt))
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: count() })
      .from(admins)
      .where(whereClause),
  ]);

  return {
    admins: rows,
    pagination: {
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    },
  };
};

const create = async (data) => {
  const insertData = { ...data };
  if (insertData.password) {
    insertData.password = await bcrypt.hash(insertData.password, 10);
  }
  if (insertData.email) {
    insertData.email = insertData.email.toLowerCase();
  }
  const [row] = await db.insert(admins).values(insertData).returning();
  return row;
};

const update = async (id, data) => {
  const updateData = { ...data, updatedAt: new Date() };
  if (updateData.password) {
    updateData.password = await bcrypt.hash(updateData.password, 10);
  }
  if (updateData.email) {
    updateData.email = updateData.email.toLowerCase();
  }
  const [row] = await db
    .update(admins)
    .set(updateData)
    .where(eq(admins.id, id))
    .returning();
  return row || null;
};

const deleteById = async (id) => {
  const [row] = await db.delete(admins).where(eq(admins.id, id)).returning();
  return row || null;
};

const comparePassword = async (admin, candidatePassword) => {
  if (!admin.password) return false;
  return bcrypt.compare(candidatePassword, admin.password);
};

module.exports = {
  findById,
  findByEmail,
  findByRefreshToken,
  findByPasswordResetToken,
  findAll,
  create,
  update,
  deleteById,
  comparePassword,
};
