const { eq, and, or, ilike, desc, count, ne, gte, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { customers, orders } = require("../db/schema");

const findById = async (id, tx = db) => {
  const [row] = await tx.select().from(customers).where(eq(customers.id, id)).limit(1);
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
  const limitNum = Math.min(5000, Math.max(1, parseInt(limit)));
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

  const [rows, [statsRow]] = await Promise.all([
    db
      .select()
      .from(customers)
      .where(whereClause)
      .orderBy(desc(customers.createdAt))
      .limit(limitNum)
      .offset(offset),
    db
      .select({
        total: count(),
        active: sql`SUM(CASE WHEN ${customers.status} = 'Active' THEN 1 ELSE 0 END)::int`,
        inactive: sql`SUM(CASE WHEN ${customers.status} = 'Inactive' THEN 1 ELSE 0 END)::int`,
        totalBalance: sql`COALESCE(SUM(${customers.balance}::numeric), 0)::float`,
      })
      .from(customers)
      .where(whereClause),
  ]);

  const total = Number(statsRow?.total || 0);

  return {
    customers: rows,
    pagination: {
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
    },
    summary: {
      total,
      active: Number(statsRow?.active || 0),
      inactive: Number(statsRow?.inactive || 0),
      totalBalance: Number(statsRow?.totalBalance || 0),
    },
  };
};

const create = async (data) => {
  const [row] = await db.insert(customers).values(data).returning();
  return row;
};

const update = async (id, data, tx = db) => {
  const [row] = await tx
    .update(customers)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(customers.id, id))
    .returning();
  return row || null;
};

// These two are the only functions in this repository that touch
// customers.balance. Nothing else in the codebase should call them directly
// for a business transaction — services/wallet.service.js is the intended
// caller, because every business debit/credit must also write a ledger
// (deposits) row, and it pairs both writes in one db.transaction() by passing
// its own `tx` through. Calling these bare, without a paired ledger entry, is
// how balances and the ledger drift apart — that is the whole reason a
// dedicated wallet service exists instead of ad hoc balance writes at call
// sites across the codebase.

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

/**
 * Resolve a messaging audience — every filter is optional and independent
 * (AND'd together); with none supplied this is just "every reachable active
 * customer." Always excludes marketing_opt_out (staff-set suppression) unless
 * a caller explicitly opts out of that, which nothing currently does.
 *
 * Returns up to `limit` rows plus the TRUE matching count, so a segment
 * larger than the cap still shows an honest recipient number in the preview
 * — the caller (messaging page) fetches the full id list separately/in
 * batches when it actually sends, rather than this being the send path.
 */
const findForSegment = async ({
  depotId,
  minOrders,
  sinceDays,
  inactiveSinceDays,
  excludeOptedOut = true,
  limit = 5000,
} = {}) => {
  const conditions = [eq(customers.status, "Active")];
  if (excludeOptedOut) conditions.push(eq(customers.marketingOptOut, false));

  if (depotId) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${orders} WHERE ${orders.customerId} = ${customers.id} AND ${orders.depotId} = ${Number(depotId)})`
    );
  }

  if (minOrders && sinceDays) {
    const since = new Date(Date.now() - Number(sinceDays) * 24 * 60 * 60 * 1000).toISOString();
    conditions.push(
      sql`(SELECT COUNT(*) FROM ${orders} WHERE ${orders.customerId} = ${customers.id} AND ${orders.createdAt} >= ${since}) >= ${Number(minOrders)}`
    );
  }

  if (inactiveSinceDays) {
    const since = new Date(Date.now() - Number(inactiveSinceDays) * 24 * 60 * 60 * 1000).toISOString();
    // Also true for a customer who has never ordered — "inactive" includes
    // "never active" rather than excluding it.
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM ${orders} WHERE ${orders.customerId} = ${customers.id} AND ${orders.createdAt} >= ${since})`
    );
  }

  const whereClause = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ id: customers.id, name: customers.name, phone: customers.phone, email: customers.email, companyName: customers.companyName })
      .from(customers)
      .where(whereClause)
      .orderBy(customers.id)
      .limit(Math.min(5000, Math.max(1, Number(limit) || 5000))),
    db.select({ total: count() }).from(customers).where(whereClause),
  ]);

  return { customers: rows, count: Number(total) };
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
  findForSegment,
  deleteById,
  existsByPhone,
  existsByEmail,
};
