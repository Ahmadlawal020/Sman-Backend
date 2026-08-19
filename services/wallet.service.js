const { eq, and, sql, asc, gt, inArray } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  customers, deposits, walletHolds, orderDepositAllocations, bankStatementLines,
} = require("../db/schema");
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
 *
 * An optional `tx` lets a caller (e.g. a bulk statement-line deposit) commit
 * the credit atomically with other writes in its own transaction — same
 * pattern as placeHold. Without one, the credit gets its own transaction.
 */
const credit = async (
  {
    customerId,
    amount,
    description = "",
    reference = "",
    paystackDetails = null,
    recordedBy = null,
    trackDeposit = true,
  },
  tx,
) => {
  const value = money(amount);
  if (value <= 0) {
    return { success: false, message: "Credit amount must be positive" };
  }

  const run = async (trx) => {
    if (reference) {
      const [existing] = await trx
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
    let updated = await customerRepo.creditBalance(customerId, value, trx);
    if (!updated) {
      return { success: false, message: "Customer not found" };
    }

    if (trackDeposit) {
      // previousDeposit is the counter as of right after the balance-only
      // update above — deposit/previousDeposit are untouched by
      // creditBalance, so this is exactly "before this credit's deposit
      // counter changed", computed inside the same transaction rather than
      // from a separate earlier read.
      const [withDeposit] = await trx
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

    const [deposit] = await trx
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
        // Starts fully unclaimed; allocateOrderFunding() draws it down as
        // orders are paid from it.
        remainingAmount: asDecimal(value),
      })
      .returning();

    return { success: true, deposit, customer: updated };
  };

  // Inside a caller's transaction a duplicate-reference violation must
  // propagate — the caller's atomic unit can't be soft-recovered here
  // (Postgres aborts it). The soft-recovery path below only applies to the
  // standalone transaction case.
  if (tx) return run(tx);
  try {
    return await db.transaction(run);
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
 * A manual deposit sourced from one or more bank-statement lines: claim the
 * lines and credit the wallet once per line — each keeps its own amount,
 * depositor, date and reference rather than being folded into a single
 * summed row, so the ledger mirrors the bank statement one row at a time.
 * All of it commits in one transaction.
 *
 * The claim is a guarded UPDATE (`WHERE status = 'UNMATCHED'`), so two staff
 * racing to use an overlapping set of lines can't both win — whoever loses
 * gets back fewer claimed rows than they asked for and the whole transaction
 * is rolled back rather than under-crediting silently.
 *
 * Amounts are never trusted from the client — each deposit's amount comes
 * from the claimed line itself.
 */
const creditFromStatementLines = async ({ customerId, bankAccountId, lineIds, staffId, description }) => {
  if (!Array.isArray(lineIds) || !lineIds.length) {
    return { success: false, message: "No statement lines were selected" };
  }

  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(bankStatementLines)
      .set({ status: "MATCHED", matchedBy: staffId ?? null, matchedAt: new Date() })
      .where(
        and(
          inArray(bankStatementLines.id, lineIds),
          eq(bankStatementLines.bankAccountId, bankAccountId),
          eq(bankStatementLines.status, "UNMATCHED"),
        ),
      )
      .returning();

    // Returning a failure object here (instead of throwing) would still let
    // Drizzle commit the transaction — silently leaving whichever lines DID
    // get claimed stuck in MATCHED with no deposit behind them. Throwing is
    // what actually rolls the partial claim back.
    if (claimed.length !== lineIds.length) {
      throw Object.assign(
        new Error("One or more of those lines were already used in another deposit — refresh and try again."),
        { status: 409 },
      );
    }

    const createdDeposits = [];
    for (const line of claimed) {
      const creditResult = await credit(
        {
          customerId,
          amount: money(line.amount),
          description:
            description ||
            `Manual deposit — bank statement line${line.narration ? `: ${line.narration}` : ` #${line.id}`}`,
          // The line's own bank reference, if it has one — falling back to a
          // synthetic key that's stable per line (so retrying a failed
          // request is idempotent) rather than per request.
          reference: line.bankRef || `STMT-${line.id}`,
          paystackDetails: {
            paymentMethod: "manual_bank_transfer",
            channel: "manual_bank_transfer",
            bankAccountId,
            senderName: line.depositor || null,
            paidAt: line.txnDate,
            statementLineIds: [line.id],
            statementLineCount: 1,
          },
          recordedBy: staffId ?? null,
        },
        tx,
      );

      // Same reasoning as the claim check above: a credit failure, or a
      // reference that unexpectedly already belonged to some other deposit,
      // must abort the whole transaction rather than leave this line
      // claimed with no (or the wrong) deposit behind it.
      if (!creditResult.success || creditResult.alreadyProcessed) {
        throw Object.assign(
          new Error(
            creditResult.alreadyProcessed
              ? `Statement line ${line.id}'s reference was already used by another deposit — refresh and try again.`
              : creditResult.message || "Credit failed",
          ),
          { status: creditResult.alreadyProcessed ? 409 : 400 },
        );
      }

      await tx
        .update(bankStatementLines)
        .set({ matchedDepositId: creditResult.deposit.id })
        .where(eq(bankStatementLines.id, line.id));

      createdDeposits.push(creditResult.deposit);
    }

    const total = claimed.reduce((sum, l) => sum + money(l.amount), 0);
    return { success: true, deposits: createdDeposits, claimedLines: claimed, totalAmount: total };
  });
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
 * Which credit deposit(s) an order's payment drew from, FIFO — oldest
 * unclaimed money first.
 *
 * Purely additive bookkeeping: called from placeHold()/releaseHold() wrapped
 * in try/catch that only logs. A bug here must never be able to fail or roll
 * back an actual payment — the balance debit above this call is the real
 * money movement and already happened by the time this runs. Any remainder
 * left unallocated came from deposits that predate this ledger
 * (remainingAmount IS NULL, so the `gt` filter below excludes them) — that's
 * expected, not an error, and the finance report surfaces it as "not tracked."
 */
const allocateOrderFunding = async (customerId, orderId, amount, tx) => {
  let remaining = money(amount);
  if (remaining <= 0) return;

  const candidates = await tx
    .select({ id: deposits.id, remainingAmount: deposits.remainingAmount })
    .from(deposits)
    .where(and(eq(deposits.customerId, customerId), eq(deposits.type, "credit"), gt(deposits.remainingAmount, 0)))
    .orderBy(asc(deposits.createdAt))
    .for("update");

  for (const d of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(money(d.remainingAmount), remaining);
    if (take <= 0) continue;

    await tx
      .update(deposits)
      .set({ remainingAmount: sql`${deposits.remainingAmount} - ${asDecimal(take)}` })
      .where(eq(deposits.id, d.id));

    await tx.insert(orderDepositAllocations).values({
      orderId,
      depositId: d.id,
      amount: asDecimal(take),
    });

    remaining -= take;
  }
};

/** Reverses allocateOrderFunding() — an order's hold was released, so nothing was actually spent. */
const deallocateOrderFunding = async (orderId, tx) => {
  const rows = await tx
    .select({ depositId: orderDepositAllocations.depositId, amount: orderDepositAllocations.amount })
    .from(orderDepositAllocations)
    .where(eq(orderDepositAllocations.orderId, orderId));

  for (const r of rows) {
    await tx
      .update(deposits)
      .set({ remainingAmount: sql`${deposits.remainingAmount} + ${r.amount}` })
      .where(eq(deposits.id, r.depositId));
  }

  await tx.delete(orderDepositAllocations).where(eq(orderDepositAllocations.orderId, orderId));
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

    try {
      await allocateOrderFunding(customerId, orderId, value, trx);
    } catch (err) {
      console.error(`[wallet] allocateOrderFunding failed for order ${orderId}:`, err.message);
    }

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

    try {
      await deallocateOrderFunding(orderId, trx);
    } catch (err) {
      console.error(`[wallet] deallocateOrderFunding failed for order ${orderId}:`, err.message);
    }

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
  creditFromStatementLines,
  debit,
  placeHold,
  releaseHold,
  convertHold,
  findHoldByOrder,
  getLedgerBalance,
  allocateOrderFunding,
  deallocateOrderFunding,
};
