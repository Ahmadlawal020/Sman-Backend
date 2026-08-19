// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const walletService = require("../services/wallet.service");
const { customerRepo } = require("../repositories");
const { closeDb } = require("./helpers");
const { seedState, seedProduct, seedCustomer, seedOrder } = require("./liveFixtures");

// The property under test throughout (live model — computed, never stored):
//   balance = SUM(sman.customer_credits.amount) - SUM(active sman.wallet_holds.amount)
// consumer_customer has no balance column at all, so the old "ledger must
// match customers.balance" check becomes: the balance every read path uses
// (customerRepo.getBalance) must equal the two ledgers netted by hand.

const suffix = Date.now().toString(36);

const currentBalance = (customerId) => walletService.getLedgerBalance(customerId);

const assertLedgerInvariant = async (customerId) => {
  const [credits, holds, balance] = await Promise.all([
    customerRepo.getCreditTotal(customerId),
    customerRepo.getActiveHoldTotal(customerId),
    customerRepo.getBalance(customerId),
  ]);
  assert.equal(balance, credits - holds, "balance must equal credit ledger minus active holds");
};

describe("wallet ledger", () => {
  let customer;
  let state;
  let product;

  // Orders live on consumer_order now: userId (not customerId), stateId (no
  // depotId anywhere), lowercase status, totalPrice (not totalAmount).
  const makeOrder = async (totalAmount) =>
    seedOrder({
      customerId: customer.id,
      stateId: state.id,
      productId: product.id,
      quantity: 100,
      price: "1.00",
      totalPrice: String(totalAmount),
    });

  before(async () => {
    customer = await seedCustomer({ name: "Wallet Ledger Test" });
    state = await seedState();
    product = await seedProduct();
  });

  after(async () => {
    // Fixtures are append-only (unique names/phones); nothing to unwind.
    await closeDb();
  });

  test("credit writes a ledger row and moves the balance atomically", async () => {
    const result = await walletService.credit({
      customerId: customer.id,
      amount: 10000,
      description: "test credit",
      reference: `wallet-test-credit-${suffix}`,
    });

    assert.equal(result.success, true);
    assert.equal(Number(result.deposit.amount), 10000);
    // customer_credits stores no running balanceAfter — the balance is
    // recomputed from the ledger, which is exactly what we assert.
    assert.equal(await currentBalance(customer.id), 10000);
    await assertLedgerInvariant(customer.id);
  });

  test("credit with a seen reference is a no-op, not a double credit", async () => {
    const result = await walletService.credit({
      customerId: customer.id,
      amount: 10000,
      reference: `wallet-test-credit-${suffix}`,
    });

    assert.equal(result.success, true);
    assert.equal(result.alreadyProcessed, true);
    assert.equal(await currentBalance(customer.id), 10000);
    await assertLedgerInvariant(customer.id);
  });

  test("concurrent credits with the same reference credit exactly once", async () => {
    // Two webhook deliveries racing: both pass the pre-check; a unique index
    // on the reference must stop the second insert so the loser reports
    // alreadyProcessed instead of double-crediting.
    //
    // KNOWN REGRESSION (live cutover): sman.customer_credits has NO unique
    // index on reference (verified against the live DB — only the pkey and
    // two plain indexes exist), even though wallet.service.js's credit()
    // catch-path is written against one. Two racing calls therefore BOTH
    // insert and the customer is credited twice. Left failing honestly —
    // this is a money bug, not a test problem. Fix: partial unique index on
    // sman.customer_credits.reference WHERE reference <> ''.
    //
    // Run on a dedicated customer so the double credit cannot poison the
    // main customer's arithmetic in the tests that follow.
    const raceCustomer = await seedCustomer({ name: "Wallet Race Credit" });
    const reference = `wallet-test-race-credit-${suffix}`;
    const results = await Promise.all([
      walletService.credit({ customerId: raceCustomer.id, amount: 5000, reference }),
      walletService.credit({ customerId: raceCustomer.id, amount: 5000, reference }),
    ]);

    assert.equal(results.filter((r) => r.success).length, 2, "both calls report success");
    assert.equal(await currentBalance(raceCustomer.id), 5000, "the duplicate reference must credit exactly once");
    assert.equal(
      results.filter((r) => r.alreadyProcessed).length,
      1,
      "exactly one call is a duplicate no-op"
    );
  });

  test("debit beyond the balance fails closed", async () => {
    const result = await walletService.debit({
      customerId: customer.id,
      amount: 999999,
      description: "should not happen",
    });

    assert.equal(result.success, false);
    assert.equal(result.insufficient, true);
    assert.equal(await currentBalance(customer.id), 10000);
  });

  test("concurrent debits cannot overspend the balance", async () => {
    // Two 6000 debits against a 10000 balance: exactly one may win. Without
    // the FOR UPDATE lock on the customer row both read 10000, both pass the
    // check, and the ledger ends at -2000.
    const results = await Promise.all([
      walletService.debit({ customerId: customer.id, amount: 6000, description: "racer A" }),
      walletService.debit({ customerId: customer.id, amount: 6000, description: "racer B" }),
    ]);

    const wins = results.filter((r) => r.success).length;
    assert.equal(wins, 1, "exactly one concurrent debit must succeed");
    assert.equal(await currentBalance(customer.id), 4000);
    await assertLedgerInvariant(customer.id);
  });

  test("hold lifecycle: place reduces balance, release restores it", async () => {
    const order = await makeOrder(1500);

    const placed = await walletService.placeHold({
      customerId: customer.id,
      orderId: order.id,
      amount: 1500,
    });
    assert.equal(placed.success, true);
    assert.equal(await currentBalance(customer.id), 2500);
    await assertLedgerInvariant(customer.id);

    // Second hold on the same order must fail, not stack (unique on order_id).
    const duplicate = await walletService.placeHold({
      customerId: customer.id,
      orderId: order.id,
      amount: 1500,
    });
    assert.equal(duplicate.success, false);
    assert.equal(duplicate.alreadyHeld, true);

    const released = await walletService.releaseHold(order.id);
    assert.equal(released.success, true);
    assert.equal(await currentBalance(customer.id), 4000);
    await assertLedgerInvariant(customer.id);

    // A released hold cannot be released (or converted) again.
    const releasedTwice = await walletService.releaseHold(order.id);
    assert.equal(releasedTwice.success, false);
    const convertedAfterRelease = await walletService.convertHold(order.id);
    assert.equal(convertedAfterRelease.success, false);
    assert.equal(await currentBalance(customer.id), 4000);
  });

  test("converting a hold writes the paired ledger rows without moving the balance", async () => {
    const order = await makeOrder(3000);

    await walletService.placeHold({
      customerId: customer.id,
      orderId: order.id,
      amount: 3000,
    });
    assert.equal(await currentBalance(customer.id), 1000);
    const creditTotalBefore = await customerRepo.getCreditTotal(customer.id);

    const converted = await walletService.convertHold(order.id, "test conversion");
    assert.equal(converted.success, true);
    assert.equal(converted.hold.status, "converted");
    // The spend row is a real Django payment record now
    // (consumer_orderpaymentrecord, order_id NOT NULL) — the old
    // deposits.type === "debit" axis has no live equivalent.
    assert.equal(Number(converted.deposit.amount), 3000);
    assert.equal(converted.deposit.orderId, order.id, "the payment record is pinned to the order");

    // Balance already moved at hold time; conversion swaps the active hold
    // for a negative credit entry, leaving the balance unchanged.
    assert.equal(await currentBalance(customer.id), 1000);
    assert.equal(
      await customerRepo.getCreditTotal(customer.id),
      creditTotalBefore - 3000,
      "the paired negative credit entry makes the spend permanent"
    );
    await assertLedgerInvariant(customer.id);

    const convertedTwice = await walletService.convertHold(order.id);
    assert.equal(convertedTwice.success, false);
  });

  test("concurrent holds cannot commit the same money twice", async () => {
    // 1000 left; two 800 holds on different orders race.
    const [orderA, orderB] = await Promise.all([makeOrder(800), makeOrder(800)]);

    const results = await Promise.all([
      walletService.placeHold({ customerId: customer.id, orderId: orderA.id, amount: 800 }),
      walletService.placeHold({ customerId: customer.id, orderId: orderB.id, amount: 800 }),
    ]);

    const wins = results.filter((r) => r.success).length;
    assert.equal(wins, 1, "exactly one concurrent hold must succeed");
    assert.equal(await currentBalance(customer.id), 200);
    await assertLedgerInvariant(customer.id);
  });
});
