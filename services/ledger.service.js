const { eq, and, sql, desc, gte, lte } = require("drizzle-orm");
const { db } = require("../config/db");
const { ledgerAccounts, ledgerEntries } = require("../db/schema");
const { emitEvent } = require("./events");

// The one place ledger money moves. Same discipline as the wallet service:
// a posting locks the account row, writes the immutable entry, and updates
// the cached running balance — one transaction, or nothing. There is no
// update or delete for entries anywhere in the codebase; corrections are
// new entries in the opposite direction (category "adjustment").

const UNIQUE_VIOLATION = "23505";
const isUniqueViolation = (err) =>
  err?.code === UNIQUE_VIOLATION || err?.cause?.code === UNIQUE_VIOLATION;

const money = (value) => Number(value || 0);
const asDecimal = (value) => money(value).toFixed(2);

const signed = (direction, amount) => (direction === "debit" ? amount : -amount);

const lockAccount = async (tx, accountId) => {
  const [row] = await tx
    .select()
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.id, accountId))
    .for("update")
    .limit(1);
  return row || null;
};

/**
 * Find or create the ledger account for an owner. Safe under concurrency:
 * a race on first use resolves via the unique (ownerType, ownerId) index.
 */
const ensureAccount = async ({ ownerType, ownerId, name }) => {
  const [existing] = await db
    .select()
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.ownerType, ownerType), eq(ledgerAccounts.ownerId, ownerId)))
    .limit(1);
  if (existing) return existing;

  try {
    const [account] = await db
      .insert(ledgerAccounts)
      .values({ ownerType, ownerId, name: name || `${ownerType} #${ownerId}` })
      .returning();
    return account;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const [account] = await db
        .select()
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.ownerType, ownerType), eq(ledgerAccounts.ownerId, ownerId)))
        .limit(1);
      return account;
    }
    throw err;
  }
};

/**
 * Append one immutable entry. Idempotent when `reference` is supplied.
 * Returns { success, entry, account } or { success: true, alreadyProcessed }.
 */
const postEntry = async ({
  ownerType,
  ownerId,
  ownerName,
  accountId,
  direction,
  category,
  amount,
  description = "",
  reference = "",
  entryDate,
  metadata = null,
  recordedBy = null,
  actor = null,
}) => {
  const value = money(amount);
  if (value <= 0) {
    return { success: false, message: "Ledger amount must be positive" };
  }
  if (direction !== "debit" && direction !== "credit") {
    return { success: false, message: "Direction must be debit or credit" };
  }

  const account = accountId
    ? { id: accountId }
    : await ensureAccount({ ownerType, ownerId, name: ownerName });

  try {
    const result = await db.transaction(async (tx) => {
      if (reference) {
        const [existing] = await tx
          .select()
          .from(ledgerEntries)
          .where(eq(ledgerEntries.reference, reference))
          .limit(1);
        if (existing) {
          return {
            success: true,
            alreadyProcessed: true,
            entry: existing,
            message: `Ledger reference ${reference} has already been recorded.`,
          };
        }
      }

      const locked = await lockAccount(tx, account.id);
      if (!locked) {
        return { success: false, message: "Ledger account not found" };
      }

      const balanceAfter = money(locked.runningBalance) + signed(direction, value);

      const [entry] = await tx
        .insert(ledgerEntries)
        .values({
          accountId: locked.id,
          direction,
          category,
          amount: asDecimal(value),
          description,
          reference,
          entryDate: entryDate || new Date().toISOString().slice(0, 10),
          balanceAfter: asDecimal(balanceAfter),
          metadata,
          recordedBy,
        })
        .returning();

      const [updatedAccount] = await tx
        .update(ledgerAccounts)
        .set({ runningBalance: asDecimal(balanceAfter), updatedAt: new Date() })
        .where(eq(ledgerAccounts.id, locked.id))
        .returning();

      return { success: true, entry, account: updatedAccount };
    });

    if (result.success && !result.alreadyProcessed) {
      emitEvent("ledger.entry_added", {
        actor: actor || undefined,
        entityType: "ledger_entry",
        entityId: result.entry.id,
        accountId: result.entry.accountId,
        direction,
        category,
        amount: asDecimal(value),
      });
    }
    return result;
  } catch (err) {
    if (isUniqueViolation(err) && reference) {
      const [existing] = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.reference, reference))
        .limit(1);
      return {
        success: true,
        alreadyProcessed: true,
        entry: existing || null,
        message: `Ledger reference ${reference} has already been recorded.`,
      };
    }
    throw err;
  }
};

const getAccount = async (ownerType, ownerId) => {
  const [account] = await db
    .select()
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.ownerType, ownerType), eq(ledgerAccounts.ownerId, ownerId)))
    .limit(1);
  return account || null;
};

/**
 * Statement: entries newest-first with pagination and optional date range.
 */
const getStatement = async ({ ownerType, ownerId, dateFrom, dateTo, page = 1, limit = 50 }) => {
  const account = await getAccount(ownerType, ownerId);
  if (!account) {
    return { account: null, entries: [], pagination: { total: 0, page: 1, pages: 0 } };
  }

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [eq(ledgerEntries.accountId, account.id)];
  if (dateFrom) conditions.push(gte(ledgerEntries.entryDate, dateFrom));
  if (dateTo) conditions.push(lte(ledgerEntries.entryDate, dateTo));
  const whereClause = and(...conditions);

  const [entries, [{ total }]] = await Promise.all([
    db
      .select()
      .from(ledgerEntries)
      .where(whereClause)
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: sql`count(*)::int` }).from(ledgerEntries).where(whereClause),
  ]);

  return {
    account,
    entries,
    pagination: { total, page: pageNum, pages: Math.ceil(total / limitNum) },
  };
};

/**
 * Recompute the balance from entries. Equal to account.runningBalance unless
 * something has bypassed postEntry.
 */
const getDerivedBalance = async (accountId) => {
  const [{ debits, credits }] = await db
    .select({
      debits: sql`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'debit' THEN ${ledgerEntries.amount} ELSE 0 END), 0)`,
      credits: sql`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'credit' THEN ${ledgerEntries.amount} ELSE 0 END), 0)`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.accountId, accountId));
  return money(debits) - money(credits);
};

/**
 * Per-owner-type totals for reporting: outstanding balances, debit/credit
 * volume, optionally grouped by category.
 */
const summarize = async ({ ownerType, dateFrom, dateTo }) => {
  const conditions = [eq(ledgerAccounts.ownerType, ownerType)];
  if (dateFrom) conditions.push(gte(ledgerEntries.entryDate, dateFrom));
  if (dateTo) conditions.push(lte(ledgerEntries.entryDate, dateTo));

  const byCategory = await db
    .select({
      category: ledgerEntries.category,
      direction: ledgerEntries.direction,
      total: sql`COALESCE(SUM(${ledgerEntries.amount}), 0)`,
      entryCount: sql`count(*)::int`,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerEntries.accountId, ledgerAccounts.id))
    .where(and(...conditions))
    .groupBy(ledgerEntries.category, ledgerEntries.direction);

  const [totals] = await db
    .select({
      accounts: sql`count(*)::int`,
      outstanding: sql`COALESCE(SUM(${ledgerAccounts.runningBalance}), 0)`,
    })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.ownerType, ownerType));

  return { totals, byCategory };
};

module.exports = {
  ensureAccount,
  postEntry,
  getAccount,
  getStatement,
  getDerivedBalance,
  summarize,
};
