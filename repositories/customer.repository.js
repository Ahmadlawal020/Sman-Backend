const { eq, and, or, ilike, desc, count, ne, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { consumerCustomer, consumerOrder, customerCredits, walletHolds } = require("../db/schema");

/**
 * consumer_customer is Django's real customer table (7 columns: id,
 * first_name, last_name, company_name, email, phone_number, created_at) —
 * see docs/LIVE_DB_CUTOVER.md §3. Gaps from the old clean-room `customers`
 * table this replaces, none silently stubbed:
 *
 *  - No status, marketing_opt_out, created_via, updated_at, phone_verified_at,
 *    last_login_at at all.
 *  - No balance/deposit/previous_deposit column — see the balance functions
 *    below, which read/write sman.customer_credits + sman.wallet_holds
 *    instead (consumer_orderpaymentrecord.order_id is NOT NULL, so Django
 *    has nowhere to record money before an order exists).
 *  - No paystack_customer_id / virtual_account_* / dva_subaccount_code —
 *    the Paystack DVA matching in payment.service.js (findByVirtualAccount /
 *    findByPaystackCustomerId) has no live backing at all. Not reimplemented
 *    here; payment.service.js needs its own decision, not a stub.
 *  - No commission_bank_name/account_name/account_number — those live on
 *    consumer_order per-order instead (commission_account_*).
 *  - No unique constraint on phone_number or email on the live schema,
 *    unlike the old table — findByPhone/findByEmail/existsBy* can no longer
 *    assume at most one match.
 *
 * `name`/`phone` are stamped onto every row returned below, alongside (never
 * replacing) the real firstName/lastName/phoneNumber columns — every caller
 * across the app (invoice email, SMS, notify() payloads, WhatsApp) was
 * already reading customer.name/customer.phone, which the live table has
 * never had under those names. Additive, so nothing that already reads the
 * real column names can regress.
 */

const withDisplay = (row) =>
  row && {
    ...row,
    name: `${row.firstName || ""} ${row.lastName || ""}`.trim(),
    phone: row.phoneNumber || "",
  };

const findById = async (id, tx = db) => {
  const [row] = await tx.select().from(consumerCustomer).where(eq(consumerCustomer.id, id)).limit(1);
  return withDisplay(row) || null;
};

const findByPhone = async (phone) => {
  const [row] = await db.select().from(consumerCustomer).where(eq(consumerCustomer.phoneNumber, phone)).limit(1);
  return withDisplay(row) || null;
};

const findByEmail = async (email) => {
  const [row] = await db
    .select()
    .from(consumerCustomer)
    .where(eq(consumerCustomer.email, email.toLowerCase()))
    .limit(1);
  return withDisplay(row) || null;
};

const findAll = async ({ search, searchType, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(5000, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (search) {
    const pattern = `%${search}%`;
    if (searchType === "email") {
      conditions.push(ilike(consumerCustomer.email, pattern));
    } else if (searchType === "phone") {
      conditions.push(ilike(consumerCustomer.phoneNumber, pattern));
    } else if (searchType === "companyName") {
      conditions.push(ilike(consumerCustomer.companyName, pattern));
    } else {
      conditions.push(
        or(
          ilike(consumerCustomer.firstName, pattern),
          ilike(consumerCustomer.lastName, pattern),
          ilike(consumerCustomer.email, pattern),
          ilike(consumerCustomer.phoneNumber, pattern),
          ilike(consumerCustomer.companyName, pattern)
        )
      );
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(consumerCustomer)
      .where(whereClause)
      .orderBy(desc(consumerCustomer.createdAt))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(consumerCustomer).where(whereClause),
  ]);

  return {
    customers: rows.map(withDisplay),
    pagination: {
      total: Number(total),
      page: pageNum,
      pages: Math.ceil(Number(total) / limitNum) || 1,
    },
  };
};

/**
 * Accepts both the live-column shape (firstName/lastName/phoneNumber) and the
 * old clean-room caller shape (`name`, `phone`) that every existing creation
 * path still sends (portal register, admin create, identity claim). Drizzle
 * silently drops unknown keys, so without this translation those callers
 * insert a row with no first_name at all and die on the NOT NULL constraint.
 *
 * Old-only fields with no live column (status, address, balance, deposit,
 * previousDeposit, createdVia, marketingOptOut) are consciously discarded —
 * see the header above: consumer_customer simply has nowhere to put them,
 * and balance is derived from sman.customer_credits, never stored.
 *
 * first_name/last_name/created_at are NOT NULL with no DB default (Django
 * fills them app-side), so they are always supplied here.
 */
const create = async (data) => {
  // status/address/balance/deposit/previousDeposit/createdVia/marketingOptOut
  // are pulled out solely so they never reach the insert.
  const { name, phone, status, address, balance, deposit, previousDeposit, createdVia, marketingOptOut, ...insertData } = data;

  if (name && !insertData.firstName && !insertData.lastName) {
    const parts = String(name).trim().split(/\s+/);
    insertData.firstName = parts[0] || "";
    insertData.lastName = parts.slice(1).join(" ");
  }
  if (phone && !insertData.phoneNumber) insertData.phoneNumber = phone;

  insertData.firstName = insertData.firstName ?? "";
  insertData.lastName = insertData.lastName ?? "";
  insertData.createdAt = insertData.createdAt ?? new Date().toISOString();
  if (insertData.email) insertData.email = insertData.email.toLowerCase();

  const [row] = await db.insert(consumerCustomer).values(insertData).returning();
  return withDisplay(row);
};

/**
 * Same legacy-shape translation as create(). Dead fields (status, address,
 * balance, …) are stripped rather than passed through: drizzle drops unknown
 * keys itself, but an update whose keys were ALL dead produced an empty SET
 * clause — a Postgres syntax error, i.e. a 500 on any such call. When
 * nothing survives the strip, the row is returned unchanged instead.
 */
// The only writable live columns. A whitelist, not a dead-key blacklist:
// the blacklist kept leaking (virtualAccount*, paystackCustomerId, …) and
// any leaked key drizzle drops still counts toward "something to update",
// producing an empty SET clause — a Postgres syntax error — when it was the
// only key. createdAt deliberately excluded: nothing should rewrite it.
const UPDATABLE_COLUMNS = ["firstName", "lastName", "companyName", "email", "phoneNumber"];

const update = async (id, data, tx = db) => {
  const { name, phone } = data;
  const updateData = {};
  for (const key of UPDATABLE_COLUMNS) {
    if (data[key] !== undefined) updateData[key] = data[key];
  }
  if (name && updateData.firstName === undefined && updateData.lastName === undefined) {
    const parts = String(name).trim().split(/\s+/);
    updateData.firstName = parts[0] || "";
    updateData.lastName = parts.slice(1).join(" ");
  }
  if (phone && updateData.phoneNumber === undefined) updateData.phoneNumber = phone;
  if (updateData.email) updateData.email = updateData.email.toLowerCase();

  if (Object.keys(updateData).length === 0) return findById(id, tx);

  const [row] = await tx.update(consumerCustomer).set(updateData).where(eq(consumerCustomer.id, id)).returning();
  return withDisplay(row) || null;
};

// ── Balance: sman.customer_credits (pre-order float) + sman.wallet_holds ──
//
// balance = SUM(customer_credits.amount) - SUM(active wallet_holds.amount)
//
// Applying credit to an order (or recording a fresh deposit) is
// order.service.js's job, not this repository's — see the note on
// customer_credits.paymentRecordId in db/schema/sman/customerCredit.js:
// consuming credit against a real order must also insert the matching
// consumer_orderpaymentrecord row in the same transaction, or Django's
// per-order ledger and this float drift apart exactly like the old
// balance/deposits pair was designed to avoid.

/**
 * Record a signed credit-ledger entry. Positive = money received (deposit,
 * overpayment carried forward); negative = applied to an order. Callers
 * writing a negative entry for an order MUST also write the paired
 * consumer_orderpaymentrecord row and set paymentRecordId, in the same `tx`.
 */
const recordCreditEntry = async (customerId, amount, { orderId, paymentRecordId, description, reference, notes, createdBy } = {}, tx = db) => {
  if (Number(amount) === 0) {
    throw new RangeError(`recordCreditEntry: amount must be non-zero, got ${amount}`);
  }
  const [row] = await tx
    .insert(customerCredits)
    .values({
      customerId,
      amount: String(amount),
      orderId: orderId ?? null,
      paymentRecordId: paymentRecordId ?? null,
      description: description ?? "",
      reference: reference ?? "",
      notes: notes ?? "",
      createdBy: createdBy ?? null,
    })
    .returning();
  return row;
};

/** Net credit balance for one customer, before subtracting active holds. */
const getCreditTotal = async (customerId, tx = db) => {
  const [row] = await tx
    .select({ total: sql`COALESCE(SUM(${customerCredits.amount}::numeric), 0)::float` })
    .from(customerCredits)
    .where(eq(customerCredits.customerId, customerId));
  return Number(row?.total || 0);
};

/**
 * Lifetime deposits: the sum of positive customer_credits entries only
 * (deposits, overpayment carried forward) — never netted against spends or
 * holds. Old clean-room `customers.deposit` was a stored running total with
 * no live equivalent (consumer_customer has no balance/deposit column at
 * all, see this file's header comment); this is the same figure
 * reconstructed from the ledger dashboard.service.js's own "vs. balance"
 * card needs.
 */
const getDepositTotal = async (customerId, tx = db) => {
  const [row] = await tx
    .select({ total: sql`COALESCE(SUM(${customerCredits.amount}::numeric), 0)::float` })
    .from(customerCredits)
    .where(and(eq(customerCredits.customerId, customerId), sql`${customerCredits.amount}::numeric > 0`));
  return Number(row?.total || 0);
};

/** Sum of this customer's active (unresolved) wallet holds. */
const getActiveHoldTotal = async (customerId, tx = db) => {
  const [row] = await tx
    .select({ total: sql`COALESCE(SUM(${walletHolds.amount}::numeric), 0)::float` })
    .from(walletHolds)
    .where(and(eq(walletHolds.customerId, customerId), eq(walletHolds.status, "active")));
  return Number(row?.total || 0);
};

/** Spendable balance: credit ledger total minus active holds. */
const getBalance = async (customerId, tx = db) => {
  const [creditTotal, holdTotal] = await Promise.all([getCreditTotal(customerId, tx), getActiveHoldTotal(customerId, tx)]);
  return creditTotal - holdTotal;
};

/**
 * Every customer with a positive credit-ledger balance, for the settlement
 * sweep. Mirrors the old findWithPositiveBalance — deliberately not paginated,
 * for the same reason as before: a sweep that silently drops customers past
 * a page boundary leaves their money unsettled with nothing logging it.
 */
const findWithPositiveBalance = async () => {
  const rows = await db
    .select({
      customerId: customerCredits.customerId,
      balance: sql`SUM(${customerCredits.amount}::numeric)::float`,
    })
    .from(customerCredits)
    .groupBy(customerCredits.customerId)
    .having(sql`SUM(${customerCredits.amount}::numeric) > 0`)
    .orderBy(customerCredits.customerId);
  return rows.map((r) => ({ id: r.customerId, balance: Number(r.balance) }));
};

const deleteById = async (id) => {
  const [row] = await db.delete(consumerCustomer).where(eq(consumerCustomer.id, id)).returning();
  return row || null;
};

const existsByPhone = async (phone, excludeId = null) => {
  const conditions = [eq(consumerCustomer.phoneNumber, phone)];
  if (excludeId) conditions.push(ne(consumerCustomer.id, excludeId));
  const [row] = await db
    .select({ id: consumerCustomer.id })
    .from(consumerCustomer)
    .where(and(...conditions))
    .limit(1);
  return !!row;
};

const existsByEmail = async (email, excludeId = null) => {
  const conditions = [eq(consumerCustomer.email, email.toLowerCase())];
  if (excludeId) conditions.push(ne(consumerCustomer.id, excludeId));
  const [row] = await db
    .select({ id: consumerCustomer.id })
    .from(consumerCustomer)
    .where(and(...conditions))
    .limit(1);
  return !!row;
};

/**
 * Resolve a messaging audience. `status`/`marketingOptOut` filters from the
 * old repository are dropped — neither column exists live, so every customer
 * is currently reachable regardless of opt-out. Flagged in the Phase 4 gap
 * report; do not silently reintroduce a fake always-true filter here.
 */
const findForSegment = async ({ depotId, minOrders, sinceDays, inactiveSinceDays, limit = 5000 } = {}) => {
  const conditions = [];

  if (depotId) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${consumerOrder} WHERE ${consumerOrder.userId} = ${consumerCustomer.id})`
    );
  }

  if (minOrders && sinceDays) {
    const since = new Date(Date.now() - Number(sinceDays) * 24 * 60 * 60 * 1000).toISOString();
    conditions.push(
      sql`(SELECT COUNT(*) FROM ${consumerOrder} WHERE ${consumerOrder.userId} = ${consumerCustomer.id} AND ${consumerOrder.createdAt} >= ${since}) >= ${Number(minOrders)}`
    );
  }

  if (inactiveSinceDays) {
    const since = new Date(Date.now() - Number(inactiveSinceDays) * 24 * 60 * 60 * 1000).toISOString();
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM ${consumerOrder} WHERE ${consumerOrder.userId} = ${consumerCustomer.id} AND ${consumerOrder.createdAt} >= ${since})`
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: consumerCustomer.id,
        firstName: consumerCustomer.firstName,
        lastName: consumerCustomer.lastName,
        phoneNumber: consumerCustomer.phoneNumber,
        email: consumerCustomer.email,
        companyName: consumerCustomer.companyName,
      })
      .from(consumerCustomer)
      .where(whereClause)
      .orderBy(consumerCustomer.id)
      .limit(Math.min(5000, Math.max(1, Number(limit) || 5000))),
    db.select({ total: count() }).from(consumerCustomer).where(whereClause),
  ]);

  return { customers: rows.map(withDisplay), count: Number(total) };
};

module.exports = {
  // Exported for the one place that loads customer rows without going
  // through this repository: session.repository's principal join. Everything
  // else should use the finders below, which stamp it automatically.
  withDisplay,
  findById,
  findByPhone,
  findByEmail,
  findAll,
  create,
  update,
  recordCreditEntry,
  getCreditTotal,
  getDepositTotal,
  getActiveHoldTotal,
  getBalance,
  findWithPositiveBalance,
  findForSegment,
  deleteById,
  existsByPhone,
  existsByEmail,
};
