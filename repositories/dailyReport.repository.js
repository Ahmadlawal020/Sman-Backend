const { eq, and, ilike, asc, desc, count, gte, lte, inArray, or, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  administrationStaffdailysalesreport,
  dailyReportExtras,
  consumerDepots,
  consumerLpgplant,
  consumerPfi,
} = require("../db/schema");

/**
 * administration_staffdailysalesreport (the live row, canonical) has no
 * review workflow or report_type — see sman/dailyReportExtras.js for the
 * 1:1 side table restoring those, and its caveat about the live table's
 * unique key not including report_type. Column renames: `reportDate` ->
 * `date`, `litresSold` -> `litresSoldToday`, `carriedOverLoading` ->
 * `yesterdayCarriedOverLoading`, `truckCount` -> `numTrucksSold`.
 */
const dailyReports = administrationStaffdailysalesreport;

const withExtras = (row) =>
  row && {
    ...row.administration_staffdailysalesreport,
    ...row.daily_report_extras,
    id: row.administration_staffdailysalesreport.id,
    reportDate: row.administration_staffdailysalesreport.date,
    litresSold: row.administration_staffdailysalesreport.litresSoldToday,
    carriedOverLoading: row.administration_staffdailysalesreport.yesterdayCarriedOverLoading,
    truckCount: row.administration_staffdailysalesreport.numTrucksSold,
  };

const baseQuery = () =>
  db
    .select()
    .from(administrationStaffdailysalesreport)
    .leftJoin(dailyReportExtras, eq(administrationStaffdailysalesreport.id, dailyReportExtras.reportId));

// Whitelist, not passthrough: sort input never reaches SQL unvalidated.
const SORTABLE = {
  reportDate: dailyReports.date,
  location: dailyReports.location,
  createdAt: dailyReports.createdAt,
  totalSalesAmount: dailyReports.totalSalesAmount,
  litresSold: dailyReports.litresSoldToday,
};

const findById = async (id) => {
  const [row] = await baseQuery().where(eq(dailyReports.id, id)).limit(1);
  return withExtras(row);
};

/**
 * A location/PFI-scoped viewer's reports are matched by name, not id —
 * `daily_reports.location`/`pfi_number` are free text typed on the filing
 * form, not foreign keys. Resolves the scope's depot/LPG-station ids to the
 * names filers would have typed, plus every PFI number that scope reaches
 * (held directly, or sitting at one of the scoped depots/stations).
 */
const scopedNames = async ({ depotIds = [], lpgStationIds = [], pfiIds = [] } = {}) => {
  const [depotRows, stationRows, pfiRows] = await Promise.all([
    depotIds.length
      ? db.select({ name: consumerDepots.name }).from(consumerDepots).where(inArray(consumerDepots.id, depotIds))
      : [],
    lpgStationIds.length
      ? db.select({ name: consumerLpgplant.name }).from(consumerLpgplant).where(inArray(consumerLpgplant.id, lpgStationIds))
      : [],
    // consumer_pfi has no depot/lpg-station FK at all (it's state-scoped, see
    // depot.repository.js's comment on per-state pricing) — only a directly
    // given pfiId can be resolved to its number now, not "every PFI at this
    // depot/station" the way the old model could.
    pfiIds.length ? db.select({ number: consumerPfi.pfiNumber }).from(consumerPfi).where(inArray(consumerPfi.id, pfiIds)) : [],
  ]);
  return {
    locationNames: [...depotRows.map((r) => r.name), ...stationRows.map((r) => r.name)],
    pfiNumbers: pfiRows.map((r) => r.number),
  };
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
  /** The authenticated caller — only set for a location/PFI-scoped viewer
   * who otherwise has oversight of every report (see the controller). */
  scopeUser,
  page = 1,
  limit = 50,
} = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (reportType) conditions.push(eq(dailyReportExtras.reportType, reportType));
  if (location) conditions.push(ilike(dailyReports.location, `%${location}%`));
  if (status) conditions.push(eq(dailyReportExtras.status, status));
  if (pfiNumber) conditions.push(eq(dailyReports.pfiNumber, pfiNumber));
  if (submittedBy) conditions.push(eq(dailyReports.submittedById, submittedBy));
  if (dateFrom) conditions.push(gte(dailyReports.date, dateFrom));
  if (dateTo) conditions.push(lte(dailyReports.date, dateTo));

  if (scopeUser && !scopeUser.canViewAllLocations) {
    const { locationNames, pfiNumbers } = await scopedNames(scopeUser.scope);
    const clauses = [];
    if (locationNames.length) clauses.push(inArray(dailyReports.location, locationNames));
    if (pfiNumbers.length) clauses.push(inArray(dailyReports.pfiNumber, pfiNumbers));
    // Scoped but assigned nothing reachable: fail closed, same rule as
    // everywhere else this scope system is enforced.
    conditions.push(clauses.length ? or(...clauses) : sql`false`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    baseQuery()
      .where(whereClause)
      .orderBy((order === "asc" ? asc : desc)(SORTABLE[sort] || dailyReports.date), desc(dailyReports.id))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(dailyReports).leftJoin(dailyReportExtras, eq(dailyReports.id, dailyReportExtras.reportId)).where(whereClause),
  ]);

  return {
    reports: rows.map(withExtras),
    pagination: { total, page: pageNum, pages: Math.ceil(total / limitNum) },
  };
};

const create = async (data, tx = db) => {
  const {
    reportType,
    productName,
    openingStock,
    receivedStock,
    avgPrice,
    yesterdayDeficitPayment,
    yesterdaySurplusPayment,
    totalInflow,
    trucksEntered,
    customerCount,
    orderCount,
    rates,
    topCustomers,
    status,
    reviewedBy,
    reviewedByName,
    reviewedAt,
    reviewComment,
    reportDate,
    litresSold,
    carriedOverLoading,
    truckCount,
    submittedBy,
    ...rest
  } = data;
  const liveData = { ...rest };
  if (reportDate !== undefined) liveData.date = reportDate;
  if (litresSold !== undefined) liveData.litresSoldToday = litresSold;
  if (carriedOverLoading !== undefined) liveData.yesterdayCarriedOverLoading = carriedOverLoading;
  if (truckCount !== undefined) liveData.numTrucksSold = truckCount;
  if (submittedBy !== undefined) liveData.submittedById = submittedBy;

  const [reportRow] = await tx.insert(dailyReports).values(liveData).returning();
  const extrasData = {
    reportType,
    productName,
    openingStock,
    receivedStock,
    avgPrice,
    yesterdayDeficitPayment,
    yesterdaySurplusPayment,
    totalInflow,
    trucksEntered,
    customerCount,
    orderCount,
    rates,
    topCustomers,
    status,
    reviewedBy,
    reviewedByName,
    reviewedAt,
    reviewComment,
  };
  for (const key of Object.keys(extrasData)) {
    if (extrasData[key] === undefined) delete extrasData[key];
  }
  const [extrasRow] = await tx.insert(dailyReportExtras).values({ reportId: reportRow.id, ...extrasData }).returning();
  return withExtras({ administration_staffdailysalesreport: reportRow, daily_report_extras: extrasRow });
};

const update = async (id, data, tx = db) => {
  const {
    reportType,
    productName,
    openingStock,
    receivedStock,
    avgPrice,
    yesterdayDeficitPayment,
    yesterdaySurplusPayment,
    totalInflow,
    trucksEntered,
    customerCount,
    orderCount,
    rates,
    topCustomers,
    status,
    reviewedBy,
    reviewedByName,
    reviewedAt,
    reviewComment,
    reportDate,
    litresSold,
    carriedOverLoading,
    truckCount,
    submittedBy,
    ...rest
  } = data;
  const liveData = { ...rest };
  if (reportDate !== undefined) liveData.date = reportDate;
  if (litresSold !== undefined) liveData.litresSoldToday = litresSold;
  if (carriedOverLoading !== undefined) liveData.yesterdayCarriedOverLoading = carriedOverLoading;
  if (truckCount !== undefined) liveData.numTrucksSold = truckCount;
  if (submittedBy !== undefined) liveData.submittedById = submittedBy;

  const extrasData = {
    reportType,
    productName,
    openingStock,
    receivedStock,
    avgPrice,
    yesterdayDeficitPayment,
    yesterdaySurplusPayment,
    totalInflow,
    trucksEntered,
    customerCount,
    orderCount,
    rates,
    topCustomers,
    status,
    reviewedBy,
    reviewedByName,
    reviewedAt,
    reviewComment,
  };
  for (const key of Object.keys(extrasData)) {
    if (extrasData[key] === undefined) delete extrasData[key];
  }

  if (Object.keys(liveData).length > 0) {
    await tx.update(dailyReports).set(liveData).where(eq(dailyReports.id, id));
  }
  if (Object.keys(extrasData).length > 0) {
    // upsert: a report predating daily_report_extras has no row there yet —
    // a plain UPDATE would silently affect 0 rows.
    await tx
      .insert(dailyReportExtras)
      .values({ reportId: id, ...extrasData })
      .onConflictDoUpdate({
        target: dailyReportExtras.reportId,
        set: { ...extrasData, updatedAt: new Date() },
      });
  }
  return findById(id);
};

/** Hard delete — a report is a submission, not a ledger entry. */
const remove = async (id) => {
  const [row] = await db.delete(dailyReports).where(eq(dailyReports.id, Number(id))).returning();
  return row || null;
};

module.exports = { findById, findAll, create, update, remove };
