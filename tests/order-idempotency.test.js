// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { db } = require("../config/db");
const { consumerOrder } = require("../db/schema");
const { eq } = require("drizzle-orm");
const { pfiRepo, orderRepo } = require("../repositories");
const { placeOrder } = require("../services/order.service");
const { closeDb } = require("./helpers");
const { seedState, seedProduct, seedPrice, seedDepot, seedPfi, seedCustomer } = require("./liveFixtures");

const RUN = Date.now();
const UNIT_PRICE = 100;

describe("placeOrder idempotency — a redelivered request must not order twice", () => {
  let customerId;
  let depotId;
  let productId;
  let pfiId;
  let stateName;

  before(async () => {
    // Live model: pricing and sellable stock are STATE-scoped. The depot joins
    // via location === state name and needs an Active bank account (manual
    // deposit only — placeOrder refuses depots without one).
    const state = await seedState();
    stateName = state.name;

    const depot = await seedDepot({ location: state.name, bankAccount: true });
    depotId = depot.id;

    const product = await seedProduct();
    productId = product.id;

    await seedPrice(productId, state.id, { price: String(UNIT_PRICE) });

    // Sold quantity is computed from consumer_pfimovement rows — there is no
    // soldQtyLitres column live (see repositories/pfi.repository.js).
    const pfi = await seedPfi({ productId, locationId: state.id, startingQtyLitres: "2000000.00" });
    pfiId = pfi.id;

    // Orders are always created Pending/Unpaid now (payment is a separate
    // explicit step), so no wallet/virtual-account setup is needed at all.
    const customer = await seedCustomer();
    customerId = customer.id;
  });

  after(async () => {
    await closeDb();
  });

  const order = (overrides = {}) =>
    placeOrder({
      customerId,
      state: stateName,
      depotId,
      productId,
      quantity: 5000,
      deliveryType: "pickup",
      trucks: [],
      ...overrides,
    });

  test("the same key twice returns the original order, reserves stock once", async () => {
    const key = `wamid.IDEM-${RUN}-1`;
    const first = await order({ idempotencyKey: key });
    assert.ok(first.order.id, "first call created an order");
    assert.ok(!first.alreadyProcessed);

    const soldAfterFirst = await pfiRepo.getSoldQty(pfiId);

    const second = await order({ idempotencyKey: key });
    assert.equal(second.order.id, first.order.id, "same order back, not a duplicate");
    assert.equal(second.alreadyProcessed, true);
    assert.equal(second.payment.accountNumber, first.payment.accountNumber);

    const soldAfterSecond = await pfiRepo.getSoldQty(pfiId);
    assert.equal(soldAfterSecond, soldAfterFirst, "no additional stock reserved by the replay");

    // idempotencyKey lives on as consumer_order.order_fingerprint (plus the
    // enforcing sman.order_idempotency row) — see order.repository.js.
    const rows = await db.select().from(consumerOrder).where(eq(consumerOrder.orderFingerprint, key));
    assert.equal(rows.length, 1, "exactly one order carries the key");
  });

  test("different keys create different orders", async () => {
    const a = await order({ idempotencyKey: `wamid.IDEM-${RUN}-A` });
    const b = await order({ idempotencyKey: `wamid.IDEM-${RUN}-B` });
    assert.notEqual(a.order.id, b.order.id);
  });

  test("no key keeps today's behaviour — every call is a new order", async () => {
    const a = await order();
    const b = await order();
    assert.notEqual(a.order.id, b.order.id);
    assert.equal(a.order.orderFingerprint ?? null, null);
  });

  test("concurrent same-key calls: exactly one order wins the race", async () => {
    const key = `wamid.IDEM-${RUN}-RACE`;
    const [a, b] = await Promise.all([order({ idempotencyKey: key }), order({ idempotencyKey: key })]);
    assert.equal(a.order.id, b.order.id, "both callers got the same order");
    assert.ok(a.alreadyProcessed || b.alreadyProcessed, "one of the two was a replay");
    const rows = await db.select().from(consumerOrder).where(eq(consumerOrder.orderFingerprint, key));
    assert.equal(rows.length, 1);
  });

  test("the replay lookup exists on the repository", async () => {
    const key = `wamid.IDEM-${RUN}-1`;
    const found = await orderRepo.findByIdempotencyKey(key);
    assert.ok(found, "findByIdempotencyKey resolves the order");
  });
});
