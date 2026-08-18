const { eq, and, or, ilike, desc, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  expectedPayments,
  consumerCustomer: customers,
  consumerOrder: orders,
  administrationUser: staff,
} = require("../db/schema");
const { scopeCondition } = require("../lib/scopeFilter");

// consumer_customer has no `.name` (split first/last) or `.phone` (it's
// `.phoneNumber`); consumer_order has no order number column at all (the
// reference is computed elsewhere from company name + id, see
// order.service.js) — dropped here rather than guessed. administration_user
// has one `.fullName`, not separate first/surname.
const COLUMNS = {
  id: expectedPayments.id,
  customerId: expectedPayments.customerId,
  orderId: expectedPayments.orderId,
  depotId: expectedPayments.depotId,
  pfiId: expectedPayments.pfiId,
  expectedAmount: expectedPayments.expectedAmount,
  reference: expectedPayments.reference,
  note: expectedPayments.note,
  status: expectedPayments.status,
  matchedDepositId: expectedPayments.matchedDepositId,
  resolvedAt: expectedPayments.resolvedAt,
  createdAt: expectedPayments.createdAt,
  updatedAt: expectedPayments.updatedAt,
  customerName: sql`CONCAT(${customers.firstName}, ' ', ${customers.lastName})`,
  customerPhone: customers.phoneNumber,
  createdByName: staff.fullName,
};

const baseQuery = () =>
  db
    .select(COLUMNS)
    .from(expectedPayments)
    .leftJoin(customers, eq(expectedPayments.customerId, customers.id))
    .leftJoin(orders, eq(expectedPayments.orderId, orders.id))
    .leftJoin(staff, eq(expectedPayments.createdBy, staff.id));

const findAll = async ({ customerId, orderId, status, search, scopeUser } = {}) => {
  const conditions = [];
  const scope = scopeCondition(scopeUser, { depotColumn: expectedPayments.depotId, pfiColumn: expectedPayments.pfiId });
  if (scope) conditions.push(scope);
  if (customerId) conditions.push(eq(expectedPayments.customerId, Number(customerId)));
  if (orderId) conditions.push(eq(expectedPayments.orderId, Number(orderId)));
  if (status && status !== "all") conditions.push(eq(expectedPayments.status, status));
  if (search) {
    const term = `%${search}%`;
    conditions.push(
      or(
        ilike(customers.firstName, term),
        ilike(customers.lastName, term),
        ilike(customers.phoneNumber, term),
        ilike(expectedPayments.reference, term)
      )
    );
  }
  const whereClause = conditions.length ? and(...conditions) : undefined;

  return baseQuery().where(whereClause).orderBy(desc(expectedPayments.createdAt));
};

const findById = async (id) => {
  const [row] = await baseQuery().where(eq(expectedPayments.id, Number(id))).limit(1);
  return row || null;
};

const create = async (data) => {
  const [row] = await db.insert(expectedPayments).values(data).returning();
  return row;
};

/** Links this note to the deposit that actually settled it — advisory only. */
const resolve = async (id, depositId) => {
  const [row] = await db
    .update(expectedPayments)
    .set({ status: "resolved", matchedDepositId: depositId, resolvedAt: new Date(), updatedAt: new Date() })
    .where(eq(expectedPayments.id, Number(id)))
    .returning();
  return row || null;
};

const cancel = async (id) => {
  const [row] = await db
    .update(expectedPayments)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(expectedPayments.id, Number(id)))
    .returning();
  return row || null;
};

module.exports = { findAll, findById, create, resolve, cancel };
