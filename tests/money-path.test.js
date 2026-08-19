// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");

const { customerRepo } = require("../repositories");
const walletService = require("../services/wallet.service");
const { seedCustomer } = require("./liveFixtures");

const { closeDb } = require("./helpers");

// The property under test: the wallet cannot be overdrawn.
//
// Live model: there is no customers.balance column (and no debitBalance/
// creditBalance on customerRepo). The balance is computed —
// SUM(sman.customer_credits) − SUM(active sman.wallet_holds) — and the ONE
// guarded spend path is wallet.service.js (debit/placeHold), which locks the
// customer's consumer_customer row FOR UPDATE before checking the balance.

/** A fresh customer holding exactly `balance` in ledger credit. */
async function fixture(balance) {
  const customer = await seedCustomer({ name: "Money Fixture" });
  if (balance > 0) {
    const credited = await walletService.credit({
      customerId: customer.id,
      amount: balance,
      description: "money-path fixture funding",
    });
    assert.equal(credited.success, true, JSON.stringify(credited));
  }
  return customer;
}

const balanceOf = (customerId) => customerRepo.getBalance(customerId);

describe("money path — the wallet cannot be overdrawn", () => {
  after(async () => {
    await closeDb();
  });

  test("a debit larger than the balance is refused", async () => {
    const c = await fixture(100);
    const result = await walletService.debit({ customerId: c.id, amount: 150, description: "overdraw attempt" });

    assert.equal(result.success, false, "refused rather than overdrawing");
    assert.equal(result.insufficient, true);
    assert.equal(await balanceOf(c.id), 100, "balance untouched");
  });

  test("a debit exactly equal to the balance succeeds", async () => {
    const c = await fixture(100);
    const result = await walletService.debit({ customerId: c.id, amount: 100, description: "exact debit" });

    assert.equal(result.success, true, "an exact debit is allowed");
    assert.equal(await balanceOf(c.id), 0);
  });

  test("concurrent debits cannot both win — this is H3", async () => {
    // The defect: the controller read the balance, then debited. Two orders
    // both read 100, both passed the check, both debited, and the account
    // ended at -100 with two Paid orders and two redeemable tickets.
    const c = await fixture(100);

    const results = await Promise.all([
      walletService.debit({ customerId: c.id, amount: 100, description: "racer 1" }),
      walletService.debit({ customerId: c.id, amount: 100, description: "racer 2" }),
      walletService.debit({ customerId: c.id, amount: 100, description: "racer 3" }),
    ]);

    const winners = results.filter((r) => r.success);
    assert.equal(winners.length, 1, "exactly one debit may succeed");

    assert.equal(await balanceOf(c.id), 0, "balance lands at zero, never negative");
  });

  test("many small concurrent debits never overdraw", async () => {
    // Ten racers against a balance covering four.
    const c = await fixture(40);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        walletService.debit({ customerId: c.id, amount: 10, description: `racer ${i}` })
      )
    );

    assert.equal(results.filter((r) => r.success).length, 4, "only what the balance covers");
    assert.equal(await balanceOf(c.id), 0);
  });

  test("the database refuses to let the ledger go negative even if the code is bypassed", async () => {
    // Pre-cutover, customers_balance_non_negative (a CHECK constraint) was
    // the backstop for a future unguarded debit — a new code path, a
    // hand-run UPDATE, a migration script.
    //
    // KNOWN REGRESSION (live cutover): the computed ledger has NO database
    // backstop at all — sman.customer_credits carries no constraint stopping
    // a raw insert from taking a customer's SUM below zero (verified: only
    // pkey + plain indexes exist). Every guard now lives in
    // wallet.service.js alone. Left failing honestly; a real fix needs a
    // trigger or deferred constraint on the ledger sum, or at minimum an
    // amount sanity check tied to the balance at insert time.
    const c = await fixture(50);
    const { db } = require("../config/db");
    const { customerCredits } = require("../db/schema");

    await assert.rejects(
      async () =>
        db.insert(customerCredits).values({
          customerId: c.id,
          amount: "-999.00",
          description: "raw unguarded debit",
        }),
      "a raw ledger entry overdrawing the wallet must be refused by the database"
    );
    assert.ok((await balanceOf(c.id)) >= 0, "the ledger can never read negative");
  });

  test("credit and debit are separate operations and each rejects the wrong sign", async () => {
    // A single signed updateBalance is how the guard came to be missing from
    // the old debit path — the two directions have different safety
    // requirements. The live wallet service keeps them separate and fails
    // closed (success: false) on a zero or negative amount.
    const c = await fixture(10);

    const badCredit = await walletService.credit({ customerId: c.id, amount: -5 });
    assert.equal(badCredit.success, false, "a negative credit is refused");
    const badDebit = await walletService.debit({ customerId: c.id, amount: -5 });
    assert.equal(badDebit.success, false, "a negative debit is refused");
    const zeroDebit = await walletService.debit({ customerId: c.id, amount: 0 });
    assert.equal(zeroDebit.success, false, "a zero debit is refused");
    assert.equal(await balanceOf(c.id), 10, "nothing moved");

    // The ledger primitive itself refuses a meaningless zero entry.
    await assert.rejects(async () => customerRepo.recordCreditEntry(c.id, 0), RangeError);
  });

  test("a credit is immediately visible in the derived balance, not a stale read", async () => {
    const c = await fixture(10);
    const credited = await walletService.credit({ customerId: c.id, amount: 15, description: "top-up" });
    assert.equal(credited.success, true);
    assert.equal(await balanceOf(c.id), 25, "callers read the post-credit balance from the ledger");
  });

  test("the settlement sweep sees every funded customer, not the first 100", async () => {
    // H7: findAll clamps limit to 100 and orders created_at DESC, so any
    // customer outside that window was never settled and nothing said so.
    const c = await fixture(500);
    const funded = await customerRepo.findWithPositiveBalance();

    assert.ok(funded.some((row) => row.id === c.id), "the funded fixture is seen");
    assert.ok(
      funded.every((row) => Number(row.balance) > 0),
      "only customers holding money"
    );
    assert.ok(
      funded.every((row) => Object.keys(row).every((k) => k === "id" || k === "balance")),
      "projection is narrow — id and balance are all the sweep needs"
    );
  });
});
