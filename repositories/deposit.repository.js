const { eq, and, desc, count, gte, lte, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { consumerOrderpaymentrecord, consumerOrder, consumerCustomer, administrationUser, customerCredits } = require("../db/schema");

/**
 * The old `deposits` table conflated two things that the live schema keeps
 * separate — see db/schema/sman/customerCredit.js and
 * customer.repository.js's balance functions:
 *
 *  - "debit" rows (money applied to a specific order) → consumer_orderpaymentrecord,
 *    Django's real per-order payment ledger (order_id NOT NULL). THIS
 *    repository wraps that table.
 *  - "credit" rows (pre-order deposits, wallet top-ups) → sman.customer_credits,
 *    which has no order yet. Use customer.repository.js's recordCreditEntry
 *    for those, not this file.
 *
 * No depotId/pfiId/type/balanceAfter/remainingAmount columns live — a
 * payment record is inherently attributed to its order's own pfi/state, and
 * "remaining unapplied" doesn't apply to a row that's always order-scoped.
 */

const findById = async (id) => {
  const [row] = await db.select().from(consumerOrderpaymentrecord).where(eq(consumerOrderpaymentrecord.id, id)).limit(1);
  return row || null;
};

const findByIdFull = async (id) => {
  const [row] = await db
    .select({
      ...consumerOrderpaymentrecord,
      customerId: consumerOrder.userId,
      customerName: consumerCustomer.firstName,
      customerLastName: consumerCustomer.lastName,
      customerPhone: consumerCustomer.phoneNumber,
      customerCompanyName: consumerCustomer.companyName,
      recorderFullName: administrationUser.fullName,
      recorderEmail: administrationUser.email,
    })
    .from(consumerOrderpaymentrecord)
    .leftJoin(consumerOrder, eq(consumerOrderpaymentrecord.orderId, consumerOrder.id))
    .leftJoin(consumerCustomer, eq(consumerOrder.userId, consumerCustomer.id))
    .leftJoin(administrationUser, eq(consumerOrderpaymentrecord.createdById, administrationUser.id))
    .where(eq(consumerOrderpaymentrecord.id, id))
    .limit(1);
  return row || null;
};

const findByReference = async (reference) => {
  const [row] = await db.select().from(consumerOrderpaymentrecord).where(eq(consumerOrderpaymentrecord.transactionReference, reference)).limit(1);
  return row || null;
};

const findByOrder = async (orderId, tx = db) => {
  return tx.select().from(consumerOrderpaymentrecord).where(eq(consumerOrderpaymentrecord.orderId, orderId)).orderBy(desc(consumerOrderpaymentrecord.createdAt));
};

const findAll = async ({ customer, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(5000, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (customer) conditions.push(eq(consumerOrder.userId, customer));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        ...consumerOrderpaymentrecord,
        customerId: consumerOrder.userId,
        customerName: consumerCustomer.firstName,
        customerLastName: consumerCustomer.lastName,
        customerPhone: consumerCustomer.phoneNumber,
        customerCompanyName: consumerCustomer.companyName,
        recorderFullName: administrationUser.fullName,
      })
      .from(consumerOrderpaymentrecord)
      .leftJoin(consumerOrder, eq(consumerOrderpaymentrecord.orderId, consumerOrder.id))
      .leftJoin(consumerCustomer, eq(consumerOrder.userId, consumerCustomer.id))
      .leftJoin(administrationUser, eq(consumerOrderpaymentrecord.createdById, administrationUser.id))
      .where(whereClause)
      .orderBy(desc(consumerOrderpaymentrecord.createdAt))
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: count() })
      .from(consumerOrderpaymentrecord)
      .leftJoin(consumerOrder, eq(consumerOrderpaymentrecord.orderId, consumerOrder.id))
      .where(whereClause),
  ]);

  return {
    deposits: rows,
    pagination: { total: Number(total), page: pageNum, pages: Math.ceil(Number(total) / limitNum) },
  };
};

/**
 * One customer's full money history — real per-order payments AND pre-order
 * credit-ledger entries, merged newest-first. Two sources because the live
 * schema keeps them in separate tables (see the file header); this is the
 * merge the old single `deposits` table gave for free.
 */
const findCustomerHistory = async ({ customerId, page = 1, limit = 50, dateFrom, dateTo } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit)));

  const paymentConditions = [eq(consumerOrder.userId, customerId)];
  if (dateFrom) paymentConditions.push(gte(consumerOrderpaymentrecord.createdAt, dateFrom));
  if (dateTo) paymentConditions.push(lte(consumerOrderpaymentrecord.createdAt, dateTo));

  const creditConditions = [eq(customerCredits.customerId, customerId)];
  if (dateFrom) creditConditions.push(gte(customerCredits.createdAt, dateFrom));
  if (dateTo) creditConditions.push(lte(customerCredits.createdAt, dateTo));

  const [payments, credits] = await Promise.all([
    db
      .select({
        id: consumerOrderpaymentrecord.id,
        source: sql`'payment_record'`.as("source"),
        type: sql`'debit'`.as("type"),
        amount: consumerOrderpaymentrecord.amount,
        reference: consumerOrderpaymentrecord.transactionReference,
        description: consumerOrderpaymentrecord.notes,
        orderId: consumerOrderpaymentrecord.orderId,
        createdAt: consumerOrderpaymentrecord.createdAt,
      })
      .from(consumerOrderpaymentrecord)
      .innerJoin(consumerOrder, eq(consumerOrderpaymentrecord.orderId, consumerOrder.id))
      .where(and(...paymentConditions)),
    db
      .select({
        id: customerCredits.id,
        source: sql`'credit_ledger'`.as("source"),
        type: sql`CASE WHEN ${customerCredits.amount}::numeric >= 0 THEN 'credit' ELSE 'debit' END`.as("type"),
        amount: customerCredits.amount,
        reference: customerCredits.reference,
        description: customerCredits.description,
        orderId: customerCredits.orderId,
        createdAt: customerCredits.createdAt,
      })
      .from(customerCredits)
      .where(and(...creditConditions)),
  ]);

  const merged = [...payments, ...credits].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total = merged.length;
  const offset = (pageNum - 1) * limitNum;

  return {
    rows: merged.slice(offset, offset + limitNum),
    pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
  };
};

const create = async (data, tx = db) => {
  const [row] = await tx.insert(consumerOrderpaymentrecord).values(data).returning();
  return row;
};

const countByCustomer = async (customerId) => {
  const [{ total }] = await db
    .select({ total: count() })
    .from(consumerOrderpaymentrecord)
    .innerJoin(consumerOrder, eq(consumerOrderpaymentrecord.orderId, consumerOrder.id))
    .where(eq(consumerOrder.userId, customerId));
  return Number(total);
};

module.exports = {
  findById,
  findByIdFull,
  findByReference,
  findByOrder,
  findAll,
  findCustomerHistory,
  create,
  countByCustomer,
};
