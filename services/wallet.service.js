const { eq, and, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { customers, deposits, walletHolds } = require("../db/schema");
const customerRepo = require("../repositories/customer.repository");

// Every operation here runs inside a single database transaction, and every
// balance change goes through customerRepo.creditBalance/debitBalance — an
// atomically guarded UPDATE (`WHERE balance >= amount` on the debit side), not
// a separate read-then-write. Two concurrent debits racing the same balance
// cannot both pass: the database itself serializes the two UPDATEs, and the
// second one's guard simply fails to match. Nothing outside this file should
// write customers.balance or insert deposits rows for wallet money movements
// — every business debit/credit must land its ledger row in the same
// transaction as the balance change, and this is the one place that does both.
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

      // Credits can never overdraw, so the guarded UPDATE only needs to
      // match on id; it returns null solely when the customer doesn't exist.
      let updated = await customerRepo.creditBalance(customerId, value, tx);
      if (!updated) {
        return { success: false, message: "Customer not found" };
      }

      if (trackDeposit) {
        // previousDeposit is the counter as of right after the balance-only
        // update above — deposit/previousDeposit are untouched by
        // creditBalance, so this is exactly "before this credit's deposit
        // counter changed", computed inside the same transaction rather than
        // from a separate earlier read.
        const [withDeposit] = await tx
          .update(customers)
          .set({
            previousDeposit: updated.deposit,
            deposit: sql`${customers.deposit} + ${value}`,
            updatedAt: new Date(),
          })
          .where(eq(customers.id, customerId))
          .returning();
        updated = withDeposit;
      }

      const [deposit] = await tx
        .insert(deposits)
        .values({
          customerId,
          amount: asDecimal(value),
          type: "credit",
          description,
          reference,
          recordedBy,
          balanceAfter: asDecimal(updated.balance),
          paystackDetails,
        })
        .returning();

      return { success: true, deposit, customer: updated };
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
 * the balance to go negative — debitBalance's guard is in the WHERE clause
 * of the UPDATE itself, not in a preceding read, so it cannot be raced.
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
    const updated = await customerRepo.debitBalance(customerId, value, tx);
    if (!updated) {
      // Same guarded result whether the customer doesn't exist or simply
      // doesn't have enough — either way, this debit does not happen.
      return { success: false, insufficient: true, message: "Insufficient wallet balance" };
    }

    const [deposit] = await tx
      .insert(deposits)
      .values({
        customerId,
        amount: asDecimal(value),
        type: "debit",
        description,
        reference,
        recordedBy,
        balanceAfter: asDecimal(updated.balance),
      })
      .returning();

    return { success: true, deposit, customer: updated };
  });
};

/**
 * Commit funds to an order. Decrements the balance so the money cannot be
 * spent twice, but writes no ledger row yet — that happens on conversion.
 * The unique index on orderId makes re-attempts fail closed (alreadyHeld)
 * instead of holding the same money twice: if the hold insert below violates
 * it, the whole transaction — including the balance decrement — rolls back.
 */
// An optional `tx` lets a caller (e.g. placeOrder) commit the hold atomically
// with the order it belongs to. Without one, the hold gets its own transaction.
const placeHold = async ({ customerId, orderId, amount, description = "" }, tx) => {
  const value = money(amount);
  if (value <= 0) {
    return { success: false, message: "Hold amount must be positive" };
  }

  const run = async (trx) => {
    const updated = await customerRepo.debitBalance(customerId, value, trx);
    if (!updated) {
      return { success: false, insufficient: true, message: "Insufficient wallet balance" };
    }

    const [hold] = await trx
      .insert(walletHolds)
      .values({
        customerId,
        orderId,
        amount: asDecimal(value),
        description,
      })
      .returning();

    return { success: true, hold, customer: updated };
  };

  // Inside a caller's transaction a duplicate-hold violation must propagate —
  // the caller's atomic unit can't be soft-recovered here (Postgres aborts it).
  // The alreadyHeld soft path only applies to the standalone transaction, whose
  // sole retry caller is the settlement sweep.
  if (tx) return run(tx);
  try {
    return await db.transaction(run);
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
const releaseHold = async (orderId, tx) => {
  const run = async (trx) => {
    const [hold] = await trx
      .select()
      .from(walletHolds)
      .where(eq(walletHolds.orderId, orderId))
      .for("update")
      .limit(1);

    if (!hold || hold.status !== "active") {
      return { success: false, noActiveHold: true, hold: hold || null };
    }

    const [updatedHold] = await trx
      .update(walletHolds)
      .set({ status: "released", resolvedAt: new Date() })
      .where(eq(walletHolds.id, hold.id))
      .returning();

    // A release can never overdraw — it is only ever returning money this
    // same hold already took.
    await customerRepo.creditBalance(hold.customerId, money(hold.amount), trx);

    return { success: true, hold: updatedHold };
  };
  return tx ? run(tx) : db.transaction(run);
};

/**
 * Finalise a hold as a spend (order fulfilled). Writes the debit ledger row;
 * the balance was already reduced when the hold was placed, so it does not
 * change here.
 */
const convertHold = async (orderId, description = "", tx) => {
  const run = async (trx) => {
    const [hold] = await trx
      .select()
      .from(walletHolds)
      .where(eq(walletHolds.orderId, orderId))
      .for("update")
      .limit(1);

    if (!hold || hold.status !== "active") {
      return { success: false, noActiveHold: true, hold: hold || null };
    }

    const [customer] = await trx
      .select()
      .from(customers)
      .where(eq(customers.id, hold.customerId))
      .for("update")
      .limit(1);

    const [deposit] = await trx
      .insert(deposits)
      .values({
        customerId: hold.customerId,
        amount: asDecimal(hold.amount),
        type: "debit",
        description: description || hold.description || "",
        balanceAfter: asDecimal(customer.balance),
      })
      .returning();

    const [updatedHold] = await trx
      .update(walletHolds)
      .set({ status: "converted", depositId: deposit.id, resolvedAt: new Date() })
      .where(eq(walletHolds.id, hold.id))
      .returning();

    return { success: true, hold: updatedHold, deposit };
  };
  return tx ? run(tx) : db.transaction(run);
};

const findHoldByOrder = async (orderId, tx = db) => {
  const [hold] = await tx
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
