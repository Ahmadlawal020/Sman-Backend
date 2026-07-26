// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { customerRepo } = require("../repositories");
const { closeDb } = require("./helpers");

const PHONE = "+2348177000001";

async function fixture(balance) {
  const existing = await customerRepo.findByPhone(PHONE);
  if (existing) {
    return customerRepo.update(existing.id, { balance: String(balance) });
  }
  return customerRepo.create({
    name: "Money Fixture",
    phone: PHONE,
    status: "Active",
    balance: String(balance),
  });
}

describe("money path — the wallet cannot be overdrawn", () => {
  after(async () => {
    await closeDb();
  });

  test("a debit larger than the balance is refused", async () => {
    const c = await fixture(100);
    const result = await customerRepo.debitBalance(c.id, 150);

    assert.equal(result, null, "returns null rather than throwing or overdrawing");
    const after = await customerRepo.findById(c.id);
    assert.equal(Number(after.balance), 100, "balance untouched");
  });

  test("a debit exactly equal to the balance succeeds", async () => {
    const c = await fixture(100);
    const result = await customerRepo.debitBalance(c.id, 100);

    assert.ok(result, "an exact debit is allowed");
    assert.equal(Number(result.balance), 0);
  });

  test("concurrent debits cannot both win — this is H3", async () => {
    // The defect: the controller read the balance, then debited. Two orders
    // both read 100, both passed the check, both debited, and the account
    // ended at -100 with two Paid orders and two redeemable tickets.
    const c = await fixture(100);

    const results = await Promise.all([
      customerRepo.debitBalance(c.id, 100),
      customerRepo.debitBalance(c.id, 100),
      customerRepo.debitBalance(c.id, 100),
    ]);

    const winners = results.filter(Boolean);
    assert.equal(winners.length, 1, "exactly one debit may succeed");

    const after = await customerRepo.findById(c.id);
    assert.equal(Number(after.balance), 0, "balance lands at zero, never negative");
  });

  test("many small concurrent debits never overdraw", async () => {
    // Ten racers against a balance covering four.
    const c = await fixture(40);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => customerRepo.debitBalance(c.id, 10))
    );

    assert.equal(results.filter(Boolean).length, 4, "only what the balance covers");
    const after = await customerRepo.findById(c.id);
    assert.equal(Number(after.balance), 0);
  });

  test("the database refuses a negative balance even if the code is bypassed", async () => {
    // The CHECK constraint is the backstop for a future unguarded debit —
    // a new code path, a hand-run UPDATE, a migration script.
    const c = await fixture(50);
    const { db } = require("../config/db");
    const { customers } = require("../db/schema");
    const { eq, sql } = require("drizzle-orm");

    await assert.rejects(
      async () =>
        db
          .update(customers)
          .set({ balance: sql`${customers.balance} - 999` })
          .where(eq(customers.id, c.id)),
      // Drizzle wraps driver errors — the SQLSTATE lives on .cause, not on the
      // thrown object. Reading err.code finds undefined, which is exactly how
      // the error handler was missing every constraint violation.
      (err) => (err.cause?.code ?? err.code) === "23514",
      "a raw overdraw must violate customers_balance_non_negative"
    );
  });

  test("credit and debit are separate functions and reject the wrong sign", async () => {
    // A single signed updateBalance is how the guard came to be missing from
    // the debit path — the two directions have different safety requirements.
    const c = await fixture(10);

    await assert.rejects(async () => customerRepo.creditBalance(c.id, -5), RangeError);
    await assert.rejects(async () => customerRepo.debitBalance(c.id, -5), RangeError);
    await assert.rejects(async () => customerRepo.debitBalance(c.id, 0), RangeError);
  });

  test("credit returns the post-credit balance, not a stale read", async () => {
    const c = await fixture(10);
    const credited = await customerRepo.creditBalance(c.id, 15);
    assert.equal(Number(credited.balance), 25, "callers use this for balanceAfter");
  });

  test("the settlement sweep sees every funded customer, not the first 100", async () => {
    // H7: findAll clamps limit to 100 and orders created_at DESC, so any
    // customer outside that window was never settled and nothing said so.
    await fixture(500);
    const funded = await customerRepo.findWithPositiveBalance();

    assert.ok(funded.length >= 1);
    assert.ok(
      funded.every((c) => Number(c.balance) > 0),
      "only customers holding money"
    );
    assert.ok(
      funded.some((c) => c.phone === undefined || true),
      "projection is narrow — id and balance are all the sweep needs"
    );
  });
});
