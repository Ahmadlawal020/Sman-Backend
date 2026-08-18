const { eq, and, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { consumerCustomer, customerCredits, walletHolds, consumerOrderpaymentrecord } = require("../db/schema");
const customerRepo = require("../repositories/customer.repository");

/**
 * consumer_customer (live) has no balance/deposit/previousDeposit column at
 * all, and consumer_orderpaymentrecord.order_id is NOT NULL — Django has
 * nowhere to record money before an order exists. See
 * repositories/customer.repository.js's header comment and
 * db/schema/sman/{customerCredit,walletHold}.js.
 *
 * The invariant this file maintains, now computed rather than stored:
 *
 *   balance = SUM(sman.customer_credits.amount) - SUM(active sman.wallet_holds.amount)
 *
 * A hold takes money out of the computed balance the moment it's placed (no
 * separate debit-ledger row — the active hold itself is what's subtracted).
 * Converting a hold is what makes the spend permanent AND pairs it with a
 * real consumer_orderpaymentrecord row, which is what keeps Django's own
 * per-order ledger in sync with this float — every other write in this file
 * must go through the same path.
 *
 * Every balance-affecting write here locks the customer's own
 * consumer_customer row first (`SELECT ... FOR UPDATE`), even though the
 * balance itself isn't stored there — it's the one row that's always safe to
 * lock per-customer, so two concurrent debits/holds against the same
 * customer serialize instead of racing past each other's balance check.
 */

const UNIQUE_VIOLATION = "23505";
const isUniqueViolation = (err) => err?.code === UNIQUE_VIOLATION || err?.cause?.code === UNIQUE_VIOLATION;

const money = (value) => Number(value || 0);
const asDecimal = (value) => money(value).toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);

const lockCustomer = async (customerId, tx) => {
  const [row] = await tx.select().from(consumerCustomer).where(eq(consumerCustomer.id, customerId)).for("update").limit(1);
  return row || null;
};

const findCreditByReference = async (reference, tx = db) => {
  if (!reference) return null;
  const [row] = await tx.select().from(customerCredits).where(eq(customerCredits.reference, reference)).limit(1);
  return row || null;
};

/**
 * Credit the wallet. Idempotent when a `reference` is supplied: a second
 * call with the same reference returns the original ledger entry untouched.
 *
 * `paystackDetails` has no dedicated column on the live ledger (customer_credits
 * only has description/reference/notes) — folded into `notes` as JSON so the
 * metadata (bank name, sender, channel) isn't silently dropped.
 *
 * `trackDeposit`'s old job (bumping customers.deposit/previousDeposit
 * counters) has nowhere to write on the live schema — there is no such
 * column — so it's a no-op now, not reimplemented.
 */
const credit = async (
  { customerId, amount, description = "", reference = "", paystackDetails = null, recordedBy = null },
  tx,
) => {
  const value = money(amount);
  if (value <= 0) {
    return { success: false, message: "Credit amount must be positive" };
  }

  const run = async (trx) => {
    if (reference) {
      const existing = await findCreditByReference(reference, trx);
      if (existing) {
        return {
          success: true,
          alreadyProcessed: true,
          deposit: existing,
          message: `Transaction reference ${reference} has already been recorded.`,
        };
      }
    }

    const customer = await lockCustomer(customerId, trx);
    if (!customer) {
      return { success: false, message: "Customer not found" };
    }

    const entry = await customerRepo.recordCreditEntry(
      customerId,
      value,
      {
        description,
        reference,
        notes: paystackDetails ? JSON.stringify(paystackDetails) : "",
        createdBy: recordedBy,
      },
      trx,
    );

    return { success: true, deposit: entry, customer };
  };

  if (tx) return run(tx);
  try {
    return await db.transaction(run);
  } catch (err) {
    // Two requests raced past the pre-check with the same reference; the
    // unique index on customer_credits.reference stopped the second one.
    if (isUniqueViolation(err) && reference) {
      const existing = await findCreditByReference(reference);
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
 * lines and credit the wallet once per line, all in one transaction.
 */
const creditFromStatementLines = async ({ customerId, bankAccountId, lineIds, staffId, description }) => {
  if (!Array.isArray(lineIds) || !lineIds.length) {
    return { success: false, message: "No statement lines were selected" };
  }
  const { consumerBankstatementline: bankStatementLines } = require("../db/schema");

  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(bankStatementLines)
      .set({ status: "MATCHED", matchedById: staffId ?? null, matchedAt: new Date().toISOString() })
      .where(
        and(
          sql`${bankStatementLines.id} = ANY(${lineIds})`,
          eq(bankStatementLines.bankAccountId, bankAccountId),
          eq(bankStatementLines.status, "UNMATCHED"),
        ),
      )
      .returning();

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
          reference: line.bankRef || `STMT-${line.id}`,
          paystackDetails: {
            paymentMethod: "manual_bank_transfer",
            channel: "manual_bank_transfer",
            bankAccountId,
            senderName: line.depositorName || null,
            paidAt: line.transactionDate,
            statementLineIds: [line.id],
            statementLineCount: 1,
          },
          recordedBy: staffId ?? null,
        },
        tx,
      );

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

      // credit() writes to sman.customer_credits, not consumer_orderpaymentrecord
      // (there's no order yet), so there's no live payment-record id to link
      // here — matchedPaymentRecordId stays null for a pre-order deposit.
      createdDeposits.push(creditResult.deposit);
    }

    const total = claimed.reduce((sum, l) => sum + money(l.amount), 0);
    return { success: true, deposits: createdDeposits, claimedLines: claimed, totalAmount: total };
  });
};

/**
 * Debit the wallet directly (no hold, no order) — e.g. an adjustment. Fails
 * rather than allowing the balance to go negative.
 */
const debit = async ({ customerId, amount, description = "", recordedBy = null }) => {
  const value = money(amount);
  if (value <= 0) {
    return { success: false, message: "Debit amount must be positive" };
  }

  return db.transaction(async (tx) => {
    const customer = await lockCustomer(customerId, tx);
    if (!customer) {
      return { success: false, insufficient: true, message: "Customer not found" };
    }
    const balance = await customerRepo.getBalance(customerId, tx);
    if (balance < value) {
      return { success: false, insufficient: true, message: "Insufficient wallet balance" };
    }

    const entry = await customerRepo.recordCreditEntry(customerId, -value, { description, createdBy: recordedBy }, tx);
    return { success: true, deposit: entry, customer };
  });
};

/**
 * Commit funds to an order. Nothing is written to the credit ledger yet —
 * the active hold itself is what customerRepo.getBalance() subtracts, so
 * placing one already makes the money unspendable elsewhere. The unique
 * index on wallet_holds.order_id makes re-attempts fail closed (alreadyHeld)
 * rather than holding the same money twice.
 */
const placeHold = async ({ customerId, orderId, amount, description = "" }, tx) => {
  const value = money(amount);
  if (value <= 0) {
    return { success: false, message: "Hold amount must be positive" };
  }

  const run = async (trx) => {
    const customer = await lockCustomer(customerId, trx);
    if (!customer) {
      return { success: false, insufficient: true, message: "Customer not found" };
    }
    const balance = await customerRepo.getBalance(customerId, trx);
    if (balance < value) {
      return { success: false, insufficient: true, message: "Insufficient wallet balance" };
    }

    const [hold] = await trx
      .insert(walletHolds)
      .values({ customerId, orderId, amount: asDecimal(value), description })
      .returning();

    return { success: true, hold, customer };
  };

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
 * Return held funds to the balance (order cancelled before fulfilment). No
 * ledger rows to undo — the hold being non-active is itself what restores
 * the computed balance.
 */
const releaseHold = async (orderId, tx) => {
  const run = async (trx) => {
    const [hold] = await trx.select().from(walletHolds).where(eq(walletHolds.orderId, orderId)).for("update").limit(1);
    if (!hold || hold.status !== "active") {
      return { success: false, noActiveHold: true, hold: hold || null };
    }

    const [updatedHold] = await trx
      .update(walletHolds)
      .set({ status: "released", resolvedAt: new Date() })
      .where(eq(walletHolds.id, hold.id))
      .returning();

    return { success: true, hold: updatedHold };
  };
  return tx ? run(tx) : db.transaction(run);
};

/**
 * Finalise a hold as a spend (order fulfilled). This is the one place that
 * makes a spend permanent: writes the real Django payment-record row
 * (consumer_orderpaymentrecord, order_id NOT NULL) AND a negative
 * customer_credits entry paired to it — without the negative entry, the
 * balance would silently recover once the hold is no longer "active".
 */
const convertHold = async (orderId, description = "", tx) => {
  const run = async (trx) => {
    const [hold] = await trx.select().from(walletHolds).where(eq(walletHolds.orderId, orderId)).for("update").limit(1);
    if (!hold || hold.status !== "active") {
      return { success: false, noActiveHold: true, hold: hold || null };
    }

    const [paymentRecord] = await trx
      .insert(consumerOrderpaymentrecord)
      .values({
        orderId,
        amount: asDecimal(hold.amount),
        paymentDate: today(),
        notes: description || hold.description || "Paid from wallet balance",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning();

    await customerRepo.recordCreditEntry(
      hold.customerId,
      -money(hold.amount),
      { orderId, paymentRecordId: paymentRecord.id, description: description || hold.description || "" },
      trx,
    );

    const [updatedHold] = await trx
      .update(walletHolds)
      .set({ status: "converted", depositId: paymentRecord.id, resolvedAt: new Date() })
      .where(eq(walletHolds.id, hold.id))
      .returning();

    return { success: true, hold: updatedHold, deposit: paymentRecord };
  };
  return tx ? run(tx) : db.transaction(run);
};

const findHoldByOrder = async (orderId, tx = db) => {
  const [hold] = await tx.select().from(walletHolds).where(eq(walletHolds.orderId, orderId)).limit(1);
  return hold || null;
};

/** Recompute the balance from the ledger — same math as customerRepo.getBalance. */
const getLedgerBalance = async (customerId) => customerRepo.getBalance(customerId);

/**
 * Which credit entry(ies) funded an order — dropped. The old per-deposit
 * `remainingAmount` FIFO tracking has no live equivalent (customer_credits
 * carries no remaining-balance column), and both callers already wrap this
 * in a try/catch that only logs — it was bookkeeping detail, never the
 * money movement itself, so a no-op here changes no actual balance.
 */
const allocateOrderFunding = async () => {};
const deallocateOrderFunding = async () => {};

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
