const { eq, and, or, ilike, desc, count, ne, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { customers } = require("../db/schema");

const findById = async (id) => {
  const [row] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return row || null;
};

const findByPhone = async (phone) => {
  const [row] = await db
    .select()
    .from(customers)
    .where(eq(customers.phone, phone))
    .limit(1);
  return row || null;
};

const findByEmail = async (email) => {
  const [row] = await db
    .select()
    .from(customers)
    .where(eq(customers.email, email.toLowerCase()))
    .limit(1);
  return row || null;
};

const findByVirtualAccount = async (accountNumber) => {
  const [row] = await db
    .select()
    .from(customers)
    .where(eq(customers.virtualAccountNumber, accountNumber))
    .limit(1);
  return row || null;
};

const findAll = async ({ search, searchType, status, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (search) {
    const pattern = `%${search}%`;
    if (searchType === "email") {
      conditions.push(ilike(customers.email, pattern));
    } else if (searchType === "phone") {
      conditions.push(ilike(customers.phone, pattern));
    } else if (searchType === "companyName") {
      conditions.push(ilike(customers.companyName, pattern));
    } else {
      conditions.push(
        or(
          ilike(customers.name, pattern),
          ilike(customers.email, pattern),
          ilike(customers.phone, pattern),
          ilike(customers.companyName, pattern)
        )
      );
    }
  }

  if (status && status !== "all") {
    conditions.push(eq(customers.status, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(customers)
      .where(whereClause)
      .orderBy(desc(customers.createdAt))
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: count() })
      .from(customers)
      .where(whereClause),
  ]);

  return {
    customers: rows,
    pagination: {
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    },
  };
};

const create = async (data) => {
  const [row] = await db.insert(customers).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const [row] = await db
    .update(customers)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(customers.id, id))
    .returning();
  return row || null;
};

const updateBalance = async (id, amount) => {
  const [row] = await db
    .update(customers)
    .set({
      balance: sql`${customers.balance} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, id))
    .returning();
  return row || null;
};

const updateDeposit = async (id, amount, previousDeposit) => {
  const [row] = await db
    .update(customers)
    .set({
      balance: sql`${customers.balance} + ${amount}`,
      deposit: sql`${customers.deposit} + ${amount}`,
      previousDeposit: previousDeposit,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, id))
    .returning();
  return row || null;
};

const deleteById = async (id) => {
  const [row] = await db.delete(customers).where(eq(customers.id, id)).returning();
  return row || null;
};

const existsByPhone = async (phone, excludeId = null) => {
  const conditions = [eq(customers.phone, phone)];
  if (excludeId) {
    conditions.push(ne(customers.id, excludeId));
  }
  const [row] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(...conditions))
    .limit(1);
  return !!row;
};

const existsByEmail = async (email, excludeId = null) => {
  const conditions = [eq(customers.email, email.toLowerCase())];
  if (excludeId) {
    conditions.push(ne(customers.id, excludeId));
  }
  const [row] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(...conditions))
    .limit(1);
  return !!row;
};

module.exports = {
  findById,
  findByPhone,
  findByEmail,
  findByVirtualAccount,
  findAll,
  create,
  update,
  updateBalance,
  updateDeposit,
  deleteById,
  existsByPhone,
  existsByEmail,
};
