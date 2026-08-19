// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { db } = require("../config/db");
const { customerRepo, depositRepo } = require("../repositories");
const walletService = require("../services/wallet.service");
const { seedState, seedProduct, seedCustomer, seedOrder } = require("./liveFixtures");
const { closeDb } = require("./helpers");

// The properties under test (H2/H6): money and its ledger move together, or
// not at all. Live model — there is no customers.balance column and no
// customerRepo.debitBalance:
//
//   balance = SUM(sman.customer_credits.amount) − SUM(active sman.wallet_holds)
//
// A spend is a negative customer_credits entry; when it pays for an order it
// MUST be paired, in the same transaction, with the real Django ledger row
// (consumer_orderpaymentrecord, order_id NOT NULL) — that pairing is what
// walletService.convertHold does, and what these tests hold to the old
// invariants: commit together, roll back together, and an abort anywhere in
// the transaction undoes the money movement.

describe("order transactions — money and its ledger roll back together (H2/H6)", () => {
  let state;
  let product;

  /** A fresh customer funded with exactly `balance` in ledger credit. */
  async function fixture(balance) {
    const customer = await seedCustomer({ name: "Tx Fixture" });
    if (balance > 0) {
      const credited = await walletService.credit({
        customerId: customer.id,
        amount: balance,
        description: "order-transaction fixture funding",
      });
      assert.equal(credited.success, true, JSON.stringify(credited));
    }
    return customer;
  }

  /** An order for the payment record to hang off (order_id is NOT NULL). */
  const makeOrder = (customerId, totalAmount) =>
    seedOrder({
      customerId,
      stateId: state.id,
      productId: product.id,
      quantity: 100,
      price: "1.00",
      totalPrice: String(totalAmount),
    });

  const balanceOf = (customerId, tx) => customerRepo.getBalance(customerId, tx);

  before(async () => {
    state = await seedState();
    product = await seedProduct();
  });

  after(async () => {
    await closeDb();
  });

  test("a debit that throws before commit leaves the balance untouched", async () => {
    const c = await fixture(100);

    await assert.rejects(
      db.transaction(async (tx) => {
        // The live debit primitive: a negative credit-ledger entry.
        const debited = await customerRepo.recordCreditEntry(c.id, -50, { description: "spend inside tx" }, tx);
        assert.ok(debited, "debit succeeded inside the tx");
        assert.equal(await balanceOf(c.id, tx), 50, "balance is 50 *within* the tx");
        throw new Error("boom — something later failed");
      }),
      /boom/
    );

    assert.equal(await balanceOf(c.id), 100, "rolled back to 100 — the debit did not persist");
  });

  test("H6: a failing ledger write rolls the debit back", async () => {
    // This is the defect. Before, the ledger write was a swallowed try/catch,
    // so a debit could commit with no ledger row. Now the paired Django
    // payment record is inside the transaction — if it fails, the money
    // movement is undone. (Old trick: type "not_a_valid_type"; the live
    // equivalent NOT NULL to violate is consumer_orderpaymentrecord.order_id.)
    const c = await fixture(100);
    const now = new Date().toISOString();

    await assert.rejects(
      db.transaction(async (tx) => {
        const debited = await customerRepo.recordCreditEntry(c.id, -40, { description: "spend awaiting ledger" }, tx);
        assert.ok(debited);
        assert.equal(await balanceOf(c.id, tx), 60, "the money moved *within* the tx");
        // Force the ledger write to fail: order_id is NOT NULL.
        await depositRepo.create(
          {
            orderId: null,
            amount: "40.00",
            paymentDate: now.slice(0, 10),
            notes: "should never persist",
            createdAt: now,
            updatedAt: now,
          },
          tx
        );
      })
    );

    assert.equal(await balanceOf(c.id), 100, "the debit rolled back with the failed ledger write");
  });

  test("a debit and its ledger row commit together", async () => {
    // The real production path for an order spend: placeHold, then
    // convertHold — one transaction writing the consumer_orderpaymentrecord
    // row AND the paired negative customer_credits entry.
    const c = await fixture(100);
    const order = await makeOrder(c.id, 30);
    const ledgerBefore = (await depositRepo.findByOrder(order.id)).length;

    const held = await walletService.placeHold({ customerId: c.id, orderId: order.id, amount: 30 });
    assert.equal(held.success, true, JSON.stringify(held));
    assert.equal(await balanceOf(c.id), 70, "the hold already makes the money unspendable");

    const converted = await walletService.convertHold(order.id, "committed together");
    assert.equal(converted.success, true, JSON.stringify(converted));

    assert.equal(await balanceOf(c.id), 70, "balance persisted");
    const ledgerAfter = await depositRepo.findByOrder(order.id);
    assert.equal(ledgerAfter.length, ledgerBefore + 1, "exactly one ledger row was added");
    assert.equal(Number(ledgerAfter[0].amount), 30);
    assert.equal(
      await customerRepo.getCreditTotal(c.id),
      70,
      "the paired negative credit entry made the spend permanent — no recovery when the hold stops being active"
    );
  });

  test("a guarded write returning null can abort the whole transaction", async () => {
    // The createOrder pattern: reserveStock returns null on a lost race; the
    // controller throws {status:400}, which rolls back everything already done
    // in the transaction — including the wallet hold placed for the order.
    // Proven here with the balance as the observable.
    const c = await fixture(100);
    const order = await makeOrder(c.id, 25);

    await assert.rejects(
      db.transaction(async (tx) => {
        const held = await walletService.placeHold(
          { customerId: c.id, orderId: order.id, amount: 25, description: "hold pending stock" },
          tx
        );
        assert.equal(held.success, true, JSON.stringify(held));
        assert.equal(await balanceOf(c.id, tx), 75, "the hold is live *within* the tx");
        // Simulate a guarded write that lost its race.
        const lost = null;
        if (!lost) throw Object.assign(new Error("Insufficient stock"), { status: 400 });
      }),
      (err) => err.status === 400
    );

    assert.equal(await balanceOf(c.id), 100, "the earlier hold was rolled back by the abort");
    assert.equal(await walletService.findHoldByOrder(order.id), null, "no orphaned hold row survives");
  });
});
