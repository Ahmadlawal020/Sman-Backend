const { eq, and, or, ilike, desc, count, ne, gte, sql } = require("drizzle-orm");
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
  if (!accountNumber) return null;
  const cleanAcc = String(accountNumber).trim();
  const [row] = await db
    .select()
    .from(customers)
    .where(eq(customers.virtualAccountNumber, cleanAcc))
    .limit(1);
  return row || null;
};

const findByPaystackCustomerId = async (customerCode) => {
  if (!customerCode) return null;
  const cleanCode = String(customerCode).trim();
  const [row] = await db
    .select()
    .from(customers)
    .where(eq(customers.paystackCustomerId, cleanCode))
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

/**
 * Add to a customer's balance. Credits only — the amount must be positive.
 *
 * Split from debiting deliberately. A single signed `updateBalance` reads as
 * symmetric, but the two directions have different safety requirements: a
 * credit can never overdraw, a debit can. Sharing one function is how the
 * guard came to be missing from the debit path.
 */
const creditBalance = async (id, amount, tx = db) => {
  if (!(Number(amount) > 0)) {
    throw new RangeError(`creditBalance: amount must be positive, got ${amount}`);
  }
  const [row] = await tx
    .update(customers)
    .set({
      balance: sql`${customers.balance} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, id))
    .returning();
  return row || null;
};

/**
 * Subtract from a customer's balance, refusing to overdraw.
 *
 * The guard is in the `WHERE`, not in a preceding read. Checking the balance
 * in the caller and then debiting is a time-of-check/time-of-use race: two
 * concurrent orders both read the same balance, both pass, both debit, and the
 * account ends up negative with two paid orders and two tickets.
 *
 * Returns null when the balance does not cover the amount — callers MUST
 * branch on that rather than assuming success. This is the same shape as
 * pfiRepo.reserveStock, which has always guarded correctly; the pattern
 * existed in this codebase and was simply never applied to money.
 *
 * @param {number} amount  positive magnitude to subtract
 * @returns {object|null}  the updated row, or null if funds were insufficient
 */
const debitBalance = async (id, amount, tx = db) => {
  if (!(Number(amount) > 0)) {
    throw new RangeError(`debitBalance: amount must be positive, got ${amount}`);
  }
  const [row] = await tx
    .update(customers)
    .set({
      balance: sql`${customers.balance} - ${amount}`,
      updatedAt: new Date(),
    })
    .where(and(eq(customers.id, id), gte(customers.balance, String(amount))))
    .returning();
  return row || null;
};

/**
 * Every customer holding money, for the settlement sweep.
 *
 * Deliberately NOT findAll({ limit }): that clamps to 100 and orders by
 * created_at DESC, so the sweep silently considered only the hundred most
 * recently created customers. Anyone older with a balance was never settled —
 * their money sat in the wallet, their order stayed unpaid, and nothing logged
 * a discrepancy because the loop believed it had processed everyone it was
 * given.
 *
 * Filtering in SQL removes the pagination question entirely rather than
 * raising a limit that would drift out of date again.
 */
const findWithPositiveBalance = async () => {
  return db
    .select({ id: customers.id, balance: customers.balance })
    .from(customers)
    .where(sql`${customers.balance} > 0`)
    .orderBy(customers.id);
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
  findByPaystackCustomerId,
  findAll,
  create,
  update,
  creditBalance,
  debitBalance,
  findWithPositiveBalance,
  updateDeposit,
  deleteById,
  existsByPhone,
  existsByEmail,
};
