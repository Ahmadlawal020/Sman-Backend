const { eq, and, ilike, desc, count, gte, lte } = require("drizzle-orm");
const { db } = require("../config/db");
const { dailyReports } = require("../db/schema");

const findById = async (id) => {
  const [row] = await db.select().from(dailyReports).where(eq(dailyReports.id, id)).limit(1);
  return row || null;
};

const findAll = async ({
  location,
  status,
  pfiNumber,
  submittedBy,
  dateFrom,
  dateTo,
  page = 1,
  limit = 50,
} = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
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
      .orderBy(desc(dailyReports.reportDate), desc(dailyReports.id))
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

module.exports = { findById, findAll, create, update };
