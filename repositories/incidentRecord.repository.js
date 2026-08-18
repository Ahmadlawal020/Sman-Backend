const { eq, and, or, ilike, asc, desc, count, gte, lte } = require("drizzle-orm");
const { db } = require("../config/db");
const { administrationRecord: incidentRecords } = require("../db/schema");

/**
 * administration_record (live, canonical) is Django's own successor of the
 * same "field records" concept this repo was already documented as
 * replacing — a much closer match than the low-confidence
 * consumer_truckbreakdown mapping in docs/LIVE_DB_CUTOVER.md §3 (that table
 * is truck-breakdown-specific: trucks/litres_per_truck/order_id, nothing
 * like a general incident/expense/observation record). Column renames:
 * `incidentType` -> `category`, `submittedBy`/`reviewedBy` -> `*ById`. No
 * `location` or separate `attachments` column — folded into the required
 * `extra` jsonb; no `resolvedAt` — callers use `reviewedAt` for that.
 */

// Whitelist, not passthrough: sort input never reaches SQL unvalidated.
const SORTABLE = {
  createdAt: incidentRecords.createdAt,
  status: incidentRecords.status,
  incidentType: incidentRecords.category,
  amount: incidentRecords.amount,
};

const findById = async (id) => {
  const [row] = await db
    .select()
    .from(incidentRecords)
    .where(eq(incidentRecords.id, id))
    .limit(1);
  return row || null;
};

const findAll = async ({
  incidentType,
  status,
  search,
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
  if (incidentType) conditions.push(eq(incidentRecords.category, incidentType));
  if (status) conditions.push(eq(incidentRecords.status, status));
  if (submittedBy) conditions.push(eq(incidentRecords.submittedById, submittedBy));
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(ilike(incidentRecords.title, pattern), ilike(incidentRecords.pfiNumber, pattern)));
  }
  if (dateFrom) conditions.push(gte(incidentRecords.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(incidentRecords.createdAt, new Date(dateTo)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(incidentRecords)
      .where(whereClause)
      .orderBy(
        (order === "asc" ? asc : desc)(SORTABLE[sort] || incidentRecords.createdAt),
        desc(incidentRecords.id)
      )
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(incidentRecords).where(whereClause),
  ]);

  return {
    records: rows,
    pagination: { total, page: pageNum, pages: Math.ceil(total / limitNum) },
  };
};

// Translates the old field names at the boundary so callers don't all need
// rewriting: incidentType -> category, submittedBy/reviewedBy -> *ById,
// attachments/metadata fold into the required `extra` jsonb (never null).
const toLiveFields = ({ incidentType, submittedBy, reviewedBy, attachments, metadata, location, resolvedAt, ...rest }) => {
  const live = { ...rest };
  if (incidentType !== undefined) live.category = incidentType;
  if (submittedBy !== undefined) live.submittedById = submittedBy;
  if (reviewedBy !== undefined) live.reviewedById = reviewedBy;
  if (attachments !== undefined || metadata !== undefined || location !== undefined) {
    live.extra = { ...(metadata || {}), attachments: attachments || [], location: location || "" };
  }
  return live;
};

const create = async (data) => {
  const liveData = toLiveFields(data);
  if (liveData.extra === undefined) liveData.extra = {};
  const [row] = await db.insert(incidentRecords).values(liveData).returning();
  return row;
};

const update = async (id, data) => {
  const [row] = await db
    .update(incidentRecords)
    .set({ ...toLiveFields(data), updatedAt: new Date() })
    .where(eq(incidentRecords.id, id))
    .returning();
  return row || null;
};

module.exports = { findById, findAll, create, update };
