const { eq, and, or, ilike, desc, asc, count, lte, gte, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { consumerFleettruck, consumerFleetledgerentry } = require("../db/schema");

/**
 * consumer_fleettruck / consumer_fleetledgerentry map closely to the old
 * fleet_trucks / fleet_ledger_entries — see docs/LIVE_DB_CUTOVER.md §3
 * (high confidence). Column renames: ledger `entryDate` -> `date`,
 * `notes` -> `description`.
 */

const findById = async (id) => {
  const [row] = await db.select().from(consumerFleettruck).where(eq(consumerFleettruck.id, id)).limit(1);
  return row || null;
};

const findByPlate = async (plateNumber) => {
  const [row] = await db.select().from(consumerFleettruck).where(eq(consumerFleettruck.plateNumber, plateNumber)).limit(1);
  return row || null;
};

const SORTABLE = {
  plateNumber: consumerFleettruck.plateNumber,
  createdAt: consumerFleettruck.createdAt,
  mileage: consumerFleettruck.mileage,
  nextServiceDate: consumerFleettruck.nextServiceDate,
};

const findAll = async ({ search, isActive, sort, order, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(ilike(consumerFleettruck.plateNumber, pattern), ilike(consumerFleettruck.driverName, pattern), ilike(consumerFleettruck.truckMake, pattern)));
  }
  if (isActive !== undefined) conditions.push(eq(consumerFleettruck.isActive, isActive));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const sortColumn = SORTABLE[sort] || consumerFleettruck.plateNumber;
  const sortDir = order === "desc" ? desc : asc;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(consumerFleettruck)
      .where(whereClause)
      .orderBy(sortDir(sortColumn), asc(consumerFleettruck.id))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(consumerFleettruck).where(whereClause),
  ]);

  return { trucks: rows, pagination: { total: Number(total), page: pageNum, pages: Math.ceil(Number(total) / limitNum) } };
};

const create = async (data) => {
  const [row] = await db.insert(consumerFleettruck).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const [row] = await db
    .update(consumerFleettruck)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(consumerFleettruck.id, id))
    .returning();
  return row || null;
};

const findExpiringCompliance = async (byDate) => {
  return db
    .select()
    .from(consumerFleettruck)
    .where(
      and(
        eq(consumerFleettruck.isActive, true),
        or(lte(consumerFleettruck.insuranceExpiry, byDate), lte(consumerFleettruck.roadWorthinessExpiry, byDate), lte(consumerFleettruck.nextServiceDate, byDate))
      )
    )
    .orderBy(asc(consumerFleettruck.plateNumber));
};

// ── Fleet ledger (append-only) ────────────────────────────────────────────────

const createLedgerEntry = async (data) => {
  const { entryDate, notes, ...rest } = data;
  // created_at/updated_at are NOT NULL with no DB default (Django stamps
  // them app-side), and the service whitelist means no caller supplies them.
  const now = new Date().toISOString();
  const [row] = await db
    .insert(consumerFleetledgerentry)
    .values({
      createdAt: now,
      updatedAt: now,
      ...rest,
      date: entryDate ?? data.date,
      description: notes ?? data.description,
    })
    .returning();
  return row;
};

const findLedgerEntries = async ({ truckId, entryType, category, dateFrom, dateTo, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (truckId) conditions.push(eq(consumerFleetledgerentry.truckId, truckId));
  if (entryType) conditions.push(eq(consumerFleetledgerentry.entryType, entryType));
  if (category) conditions.push(ilike(consumerFleetledgerentry.category, `%${category}%`));
  if (dateFrom) conditions.push(gte(consumerFleetledgerentry.date, dateFrom));
  if (dateTo) conditions.push(lte(consumerFleetledgerentry.date, dateTo));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(consumerFleetledgerentry)
      .where(whereClause)
      .orderBy(desc(consumerFleetledgerentry.date), desc(consumerFleetledgerentry.id))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(consumerFleetledgerentry).where(whereClause),
  ]);

  return { entries: rows, pagination: { total: Number(total), page: pageNum, pages: Math.ceil(Number(total) / limitNum) } };
};

const summarizeLedger = async ({ truckId, dateFrom, dateTo } = {}) => {
  const conditions = [];
  if (truckId) conditions.push(eq(consumerFleetledgerentry.truckId, truckId));
  if (dateFrom) conditions.push(gte(consumerFleetledgerentry.date, dateFrom));
  if (dateTo) conditions.push(lte(consumerFleetledgerentry.date, dateTo));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totals] = await db
    .select({
      expenses: sql`COALESCE(SUM(CASE WHEN ${consumerFleetledgerentry.entryType} = 'expense' THEN ${consumerFleetledgerentry.amount} ELSE 0 END), 0)`,
      income: sql`COALESCE(SUM(CASE WHEN ${consumerFleetledgerentry.entryType} = 'income' THEN ${consumerFleetledgerentry.amount} ELSE 0 END), 0)`,
      entryCount: sql`count(*)::int`,
    })
    .from(consumerFleetledgerentry)
    .where(whereClause);

  const byCategory = await db
    .select({
      category: consumerFleetledgerentry.category,
      entryType: consumerFleetledgerentry.entryType,
      total: sql`COALESCE(SUM(${consumerFleetledgerentry.amount}), 0)`,
      entryCount: sql`count(*)::int`,
    })
    .from(consumerFleetledgerentry)
    .where(whereClause)
    .groupBy(consumerFleetledgerentry.category, consumerFleetledgerentry.entryType);

  return { totals, byCategory };
};

module.exports = {
  findById,
  findByPlate,
  findAll,
  create,
  update,
  findExpiringCompliance,
  createLedgerEntry,
  findLedgerEntries,
  summarizeLedger,
};
