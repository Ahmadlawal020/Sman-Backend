const { eq, and, ilike, asc, desc, count, gte, lte } = require("drizzle-orm");
const { db } = require("../config/db");
const { dailyReports } = require("../db/schema");

// Whitelist, not passthrough: sort input never reaches SQL unvalidated.
const SORTABLE = {
  reportDate: dailyReports.reportDate,
  location: dailyReports.location,
  createdAt: dailyReports.createdAt,
  totalSalesAmount: dailyReports.totalSalesAmount,
  litresSold: dailyReports.litresSold,
};

const findById = async (id) => {
  const [row] = await db.select().from(dailyReports).where(eq(dailyReports.id, id)).limit(1);
  return row || null;
};

const findAll = async ({
  /**
   * Filtered in SQL, not after the fact.
   *
   * The system this replaces fetched 50 mixed rows and filtered client-side,
   * so a busy week of other people's reports could push yours off the page
   * entirely — and the pager would still say "1 of 1".
   */
  reportType,
  location,
  status,
  pfiNumber,
  submittedBy,
  dateFrom,
  dateTo,
  sort,
  order,
  page = 1,
  limit = 50,
} = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (reportType) conditions.push(eq(dailyReports.reportType, reportType));
  if (location) conditions.push(ilike(dailyReports.location, `%${location}%`));
  if (status) conditions.push(eq(dailyReports.status, status));
  if (pfiNumber) conditions.push(eq(dailyReports.pfiNumber, pfiNumber));
  if (submittedBy) conditions.push(eq(dailyReports.submittedBy, submittedBy));
  if (dateFrom) conditions.push(gte(dailyReports.reportDate, dateFrom));
  if (dateTo) conditions.push(lte(dailyReports.reportDate, dateTo));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(dailyReports)
      .where(whereClause)
      .orderBy(
        (order === "asc" ? asc : desc)(SORTABLE[sort] || dailyReports.reportDate),
        desc(dailyReports.id)
      )
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(dailyReports).where(whereClause),
  ]);

  return {
    reports: rows,
    pagination: { total, page: pageNum, pages: Math.ceil(total / limitNum) },
  };
};

const create = async (data) => {
  const [row] = await db.insert(dailyReports).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const [row] = await db
    .update(dailyReports)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(dailyReports.id, id))
    .returning();
  return row || null;
};

/** Hard delete — a report is a submission, not a ledger entry. */
const remove = async (id) => {
  const [row] = await db.delete(dailyReports).where(eq(dailyReports.id, Number(id))).returning();
  return row || null;
};

module.exports = { findById, findAll, create, update, remove };
