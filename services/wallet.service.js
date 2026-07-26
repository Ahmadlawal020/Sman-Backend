const { eq, and, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { customers, deposits, walletHolds } = require("../db/schema");

// Every operation here runs inside a single database transaction and takes a
// row lock (SELECT ... FOR UPDATE) on the customer before reading the balance,
// so two concurrent debits cannot both pass the sufficiency check. Nothing
// outside this file should write customers.balance or insert deposits rows
// for wallet money movements.
//
// The invariant these operations maintain:
//
//   customers.balance = sum(credit deposits) - sum(debit deposits)
//                       - sum(active holds)
//
// getLedgerBalance() recomputes the right-hand side for reconciliation.

const UNIQUE_VIOLATION = "23505";

// Drizzle wraps driver errors; the Postgres error code is on the cause.
const isUniqueViolation = (err) =>
  err?.code === UNIQUE_VIOLATION || err?.cause?.code === UNIQUE_VIOLATION;

const money = (value) => Number(value || 0);
const asDecimal = (value) => money(value).toFixed(2);

const lockCustomer = async (tx, customerId) => {
  const [row] = await tx
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .for("update")
    .limit(1);
  return row || null;
};

/**
 * Credit the wallet. Idempotent when a `reference` is supplied: a second call
 * with the same reference returns the original deposit row untouched.
 *
 * `trackDeposit` also bumps the customers.deposit / previousDeposit counters —
 * true for genuine money-in (bank transfer, manual deposit), false for
 * refunds, which are returned money rather than new deposits.
 */
const credit = async ({
  customerId,
  amount,
  description = "",
  reference = "",
  paystackDetails = null,
  recordedBy = null,
  trackDeposit = true,
}) => {
  const value = money(amount);
  if (value <= 0) {
    return { success: false, message: "Credit amount must be positive" };
  }

  try {
    return await db.transaction(async (tx) => {
      if (reference) {
        const [existing] = await tx
          .select()
          .from(deposits)
          .where(eq(deposits.reference, reference))
          .limit(1);
        if (existing) {
          return {
            success: true,
            alreadyProcessed: true,
            deposit: existing,
            message: `Transaction reference ${reference} has already been recorded.`,
          };
        }
      }

      const customer = await lockCustomer(tx, customerId);
      if (!customer) {
        return { success: false, message: "Customer not found" };
      }

      const newBalance = money(customer.balance) + value;

      const [deposit] = await tx
        .insert(deposits)
        .values({
          customerId,
          amount: asDecimal(value),
          type: "credit",
          description,
          reference,
          recordedBy,
          balanceAfter: asDecimal(newBalance),
          paystackDetails,
        })
        .returning();

      const update = {
        balance: asDecimal(newBalance),
        updatedAt: new Date(),
      };
      if (trackDeposit) {
        update.previousDeposit = asDecimal(customer.deposit);
        update.deposit = asDecimal(money(customer.deposit) + value);
      }

      const [updatedCustomer] = await tx
        .update(customers)
        .set(update)
        .where(eq(customers.id, customerId))
        .returning();

      return { success: true, deposit, customer: updatedCustomer };
    });
  } catch (err) {
    // Two requests raced past the pre-check with the same reference; the
    // partial unique index on deposits.reference stopped the second one.
    if (isUniqueViolation(err) && reference) {
      const [existing] = await db
        .select()
        .from(deposits)
        .where(eq(deposits.reference, reference))
        .limit(1);
      return {
        success: true,
        alreadyProcessed: true,
        deposit: existing || null,
        message: `Transaction reference ${reference} has already been recorded.`,
      };
    }
    throw err;
  }
};

/**
 * Debit the wallet directly (no hold involved). Fails rather than allowing
 * the balance to go negative.
 */
const debit = async ({
  customerId,
  amount,
  description = "",
  reference = "",
  recordedBy = null,
}) => {
  const value = money(amount);
  if (value <= 0) {
    return { success: false, message: "Debit amount must be positive" };
  }

  return db.transaction(async (tx) => {
    const customer = await lockCustomer(tx, customerId);
    if (!customer) {
      return { success: false, message: "Customer not found" };
    }

    if (money(customer.balance) < value) {
      return { success: false, insufficient: true, message: "Insufficient wallet balance" };
    }

    const newBalance = money(customer.balance) - value;

    const [deposit] = await tx
      .insert(deposits)
      .values({
        customerId,
        amount: asDecimal(value),
        type: "debit",
        description,
        reference,
        recordedBy,
        balanceAfter: asDecimal(newBalance),
      })
      .returning();

    const [updatedCustomer] = await tx
      .update(customers)
      .set({ balance: asDecimal(newBalance), updatedAt: new Date() })
      .where(eq(customers.id, customerId))
      .returning();

    return { success: true, deposit, customer: updatedCustomer };
  });
};

/**
 * Commit funds to an order. Decrements the balance so the money cannot be
 * spent twice, but writes no ledger row yet — that happens on conversion.
 * The unique index on orderId makes re-attempts fail closed (alreadyHeld)
 * instead of holding the same money twice.
 */
const placeHold = async ({ customerId, orderId, amount, description = "" }) => {
  const value = money(amount);
  if (value <= 0) {
    return { success: false, message: "Hold amount must be positive" };
  }

  try {
    return await db.transaction(async (tx) => {
      const customer = await lockCustomer(tx, customerId);
      if (!customer) {
        return { success: false, message: "Customer not found" };
      }

      if (money(customer.balance) < value) {
        return { success: false, insufficient: true, message: "Insufficient wallet balance" };
      }

      const [hold] = await tx
        .insert(walletHolds)
        .values({
          customerId,
          orderId,
          amount: asDecimal(value),
          description,
        })
        .returning();

      const [updatedCustomer] = await tx
        .update(customers)
        .set({
          balance: asDecimal(money(customer.balance) - value),
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customerId))
        .returning();

      return { success: true, hold, customer: updatedCustomer };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { success: false, alreadyHeld: true, message: "A hold already exists for this order" };
    }
    throw err;
  }
};

/**
 * Return held funds to the balance (order cancelled before fulfilment).
 * No ledger rows: the money never actually moved.
 */
const releaseHold = async (orderId) => {
  return db.transaction(async (tx) => {
    const [hold] = await tx
      .select()
      .from(walletHolds)
      .where(eq(walletHolds.orderId, orderId))
      .for("update")
      .limit(1);

    if (!hold || hold.status !== "active") {
      return { success: false, noActiveHold: true, hold: hold || null };
    }

    const customer = await lockCustomer(tx, hold.customerId);

    const [updatedHold] = await tx
      .update(walletHolds)
      .set({ status: "released", resolvedAt: new Date() })
      .where(eq(walletHolds.id, hold.id))
      .returning();

    await tx
      .update(customers)
      .set({
        balance: asDecimal(money(customer.balance) + money(hold.amount)),
        updatedAt: new Date(),
      })
      .where(eq(customers.id, hold.customerId));

    return { success: true, hold: updatedHold };
  });
};

/**
 * Finalise a hold as a spend (order fulfilled). Writes the debit ledger row;
 * the balance was already reduced when the hold was placed, so it does not
 * change here.
 */
const convertHold = async (orderId, description = "") => {
  return db.transaction(async (tx) => {
    const [hold] = await tx
      .select()
      .from(walletHolds)
      .where(eq(walletHolds.orderId, orderId))
      .for("update")
      .limit(1);

    if (!hold || hold.status !== "active") {
      return { success: false, noActiveHold: true, hold: hold || null };
    }

    const customer = await lockCustomer(tx, hold.customerId);

    const [deposit] = await tx
      .insert(deposits)
      .values({
        customerId: hold.customerId,
        amount: asDecimal(hold.amount),
        type: "debit",
        description: description || hold.description || "",
        balanceAfter: asDecimal(customer.balance),
      })
      .returning();

    const [updatedHold] = await tx
      .update(walletHolds)
      .set({ status: "converted", depositId: deposit.id, resolvedAt: new Date() })
      .where(eq(walletHolds.id, hold.id))
      .returning();

    return { success: true, hold: updatedHold, deposit };
  });
};

const findHoldByOrder = async (orderId) => {
  const [hold] = await db
    .select()
    .from(walletHolds)
    .where(eq(walletHolds.orderId, orderId))
    .limit(1);
  return hold || null;
};

/**
 * Recompute the balance from the ledger. Equal to customers.balance unless
 * something has written balances outside this service.
 */
const getLedgerBalance = async (customerId) => {
  const [{ credits, debits }] = await db
    .select({
      credits: sql`COALESCE(SUM(CASE WHEN ${deposits.type} = 'credit' THEN ${deposits.amount} ELSE 0 END), 0)`,
      debits: sql`COALESCE(SUM(CASE WHEN ${deposits.type} = 'debit' THEN ${deposits.amount} ELSE 0 END), 0)`,
    })
    .from(deposits)
    .where(eq(deposits.customerId, customerId));

  const [{ held }] = await db
    .select({ held: sql`COALESCE(SUM(${walletHolds.amount}), 0)` })
    .from(walletHolds)
    .where(and(eq(walletHolds.customerId, customerId), eq(walletHolds.status, "active")));

  return money(credits) - money(debits) - money(held);
};

module.exports = {
  credit,
  debit,
  placeHold,
  releaseHold,
  convertHold,
  findHoldByOrder,
  getLedgerBalance,
};
