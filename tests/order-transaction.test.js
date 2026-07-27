// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { db } = require("../config/db");
const { customerRepo, depositRepo, pfiRepo } = require("../repositories");
const { closeDb } = require("./helpers");

const PHONE = "+2348199000001";

async function fixture(balance) {
  const existing = await customerRepo.findByPhone(PHONE);
  if (existing) return customerRepo.update(existing.id, { balance: String(balance) });
  return customerRepo.create({ name: "Tx Fixture", phone: PHONE, status: "Active", balance: String(balance) });
}

async function countDeposits(customerId) {
  const rows = await depositRepo.findByCustomer
    ? await depositRepo.findByCustomer(customerId)
    : null;
  return rows ? rows.length : null;
}

describe("order transactions — money and its ledger roll back together (H2/H6)", () => {
  after(async () => {
    await closeDb();
  });

  test("a debit that throws before commit leaves the balance untouched", async () => {
    const c = await fixture(100);

    await assert.rejects(
      db.transaction(async (tx) => {
        const debited = await customerRepo.debitBalance(c.id, 50, tx);
        assert.ok(debited, "debit succeeded inside the tx");
        assert.equal(Number(debited.balance), 50, "balance is 50 *within* the tx");
        throw new Error("boom — something later failed");
      }),
      /boom/
    );

    const after = await customerRepo.findById(c.id);
    assert.equal(Number(after.balance), 100, "rolled back to 100 — the debit did not persist");
  });

  test("H6: a failing ledger write rolls the debit back", async () => {
    // This is the defect. Before, the deposit was a swallowed try/catch, so a
    // debit could commit with no ledger row. Now the deposit is inside the
    // transaction — if it fails, the money movement is undone.
    const c = await fixture(100);

    await assert.rejects(
      db.transaction(async (tx) => {
        const debited = await customerRepo.debitBalance(c.id, 40, tx);
        assert.ok(debited);
        // Force the ledger write to fail: `type` only accepts credit|debit.
        await depositRepo.create(
          {
            customerId: c.id,
            amount: "40",
            type: "not_a_valid_type",
            description: "should never persist",
            balanceAfter: "60",
          },
          tx
        );
      })
    );

    const after = await customerRepo.findById(c.id);
    assert.equal(Number(after.balance), 100, "the debit rolled back with the failed ledger write");
  });

  test("a debit and its ledger row commit together", async () => {
    const c = await fixture(100);
    const before = await countDeposits(c.id);

    const balanceAfter = await db.transaction(async (tx) => {
      const debited = await customerRepo.debitBalance(c.id, 30, tx);
      await depositRepo.create(
        {
          customerId: c.id,
          amount: "30",
          type: "debit",
          description: "committed together",
          balanceAfter: String(debited.balance),
        },
        tx
      );
      return debited.balance;
    });

    assert.equal(Number(balanceAfter), 70);
    const after = await customerRepo.findById(c.id);
    assert.equal(Number(after.balance), 70, "balance persisted");
    if (before !== null) {
      assert.equal(await countDeposits(c.id), before + 1, "exactly one ledger row was added");
    }
  });

  test("a guarded write returning null can abort the whole transaction", async () => {
    // The createOrder pattern: reserveStock returns null on a lost race; the
    // controller throws {status:400}, which rolls back everything already done
    // in the transaction. Proven here with the balance as the observable.
    const c = await fixture(100);

    await assert.rejects(
      db.transaction(async (tx) => {
        await customerRepo.debitBalance(c.id, 25, tx);
        // Simulate a guarded write that lost its race.
        const lost = null;
        if (!lost) throw Object.assign(new Error("Insufficient stock"), { status: 400 });
      }),
      (err) => err.status === 400
    );

    const after = await customerRepo.findById(c.id);
    assert.equal(Number(after.balance), 100, "the earlier debit was rolled back by the abort");
  });
});
