// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { db } = require("../config/db");
const { dangoteOrderRequests } = require("../db/schema");
const walletService = require("../services/wallet.service");
const accountDeletion = require("../services/accountDeletion.service");
const { generateOrderReference } = require("../utils/helpers");
const { closeDb } = require("./helpers");
const { seedState, seedProduct, seedCustomer, seedOrder } = require("./liveFixtures");

const RUN = Date.now();

// Live consumer_order: userId + stateId (no depotId), lowercase status. The
// Sman statuses the old suite spoke map as Paid→paid, Released→released,
// Pending→pending (utils/orderStatusMapping.js).
const LIVE_STATUS = { Paid: "paid", Released: "released", Pending: "pending" };

describe("account deletion blockers", () => {
  let stateId;
  let productId;

  before(async () => {
    stateId = (await seedState()).id;
    productId = (await seedProduct()).id;
  });

  after(async () => {
    await closeDb();
  });

  const makeOrder = (customerId, status) =>
    seedOrder({
      customerId,
      stateId,
      productId,
      quantity: 33000,
      price: "100.00",
      totalPrice: "3300000.00",
      status: LIVE_STATUS[status],
      ...(status !== "Pending" ? { paymentConfirmedAt: new Date().toISOString() } : {}),
    });

  test("Paid in-progress orders name the refs and say they cannot be cancelled", async () => {
    const customer = await seedCustomer({
      name: "Delete Blocker",
      companyName: "Honeywell Adada",
    });
    const a = await makeOrder(customer.id, "Paid");
    const b = await makeOrder(customer.id, "Released");
    // consumer_order stores no per-order company — the customer's own
    // companyName is the only source for the reference now.
    const refA = generateOrderReference("Honeywell Adada", a.id);
    const refB = generateOrderReference("Honeywell Adada", b.id);

    const { blockers } = await accountDeletion.collectBlockers(customer.id);
    const message = accountDeletion.formatBlockerMessage(blockers);

    assert.equal(blockers.length, 1);
    assert.match(message, /2 orders in progress/i);
    assert.match(message, new RegExp(refA));
    assert.match(message, new RegExp(refB));
    assert.match(message, /can't be cancelled/i);
    assert.doesNotMatch(message, /ORD-/i);
    assert.doesNotMatch(message, /funds on hold/i);
  });

  test("unpaid Pending orders ask the customer to cancel them by ref", async () => {
    const customer = await seedCustomer({
      name: "Delete Unpaid",
      companyName: "Shell Petroleum",
    });
    const order = await makeOrder(customer.id, "Pending");
    const ref = generateOrderReference("Shell Petroleum", order.id);

    const { blockers } = await accountDeletion.collectBlockers(customer.id);
    const message = accountDeletion.formatBlockerMessage(blockers);

    assert.equal(blockers.length, 1);
    assert.match(message, new RegExp(`Cancel unpaid order ${ref}`));
    assert.doesNotMatch(message, /ORD-/i);
  });

  test("open Dangote requests name the customer-facing reference", async () => {
    const customer = await seedCustomer({
      name: "Delete Dangote",
      companyName: "Samcode Oil",
    });
    const [req] = await db
      .insert(dangoteOrderRequests)
      .values({
        requestNumber: `GW-DEL-${RUN}`,
        customerId: customer.id,
        product: "Cement",
        quantity: 10,
        quantityUnit: "Tons",
        deliveryAddress: "Somewhere",
        companyName: "Samcode Oil",
        status: "Approved",
        paymentStatus: "Unpaid",
      })
      .returning();
    const ref = generateOrderReference("Samcode Oil", req.id);

    const { blockers } = await accountDeletion.collectBlockers(customer.id);
    const message = accountDeletion.formatBlockerMessage(blockers);

    assert.equal(blockers.length, 1);
    assert.match(message, new RegExp(ref));
    assert.match(message, /Dangote/i);
    assert.doesNotMatch(message, new RegExp(`GW-DEL-${RUN}`));
  });

  test("formatRefs truncates long lists", () => {
    assert.equal(
      accountDeletion.formatRefs(["A", "B", "C", "D", "E", "F"], 5),
      "A, B, C, D, E, and 1 more"
    );
  });

  test("wallet balance names the amount and does not invent a withdraw path", async () => {
    const customer = await seedCustomer({ name: "Delete Balance" });
    // The balance is the sman credit ledger now, not a customers column.
    const credited = await walletService.credit({
      customerId: customer.id,
      amount: 15000.5,
      description: "account-deletion balance fixture",
    });
    assert.equal(credited.success, true, JSON.stringify(credited));

    const { blockers } = await accountDeletion.collectBlockers(customer.id);
    const message = accountDeletion.formatBlockerMessage(blockers);

    assert.equal(blockers.length, 1);
    assert.match(message, /₦15,000\.50/);
    assert.match(message, /wallet/i);
    assert.match(message, /Spend it on an order/i);
    assert.doesNotMatch(message, /Withdraw/i);
  });
});
