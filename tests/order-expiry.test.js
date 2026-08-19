// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { eq } = require("drizzle-orm");

const app = require("../app");
const { db } = require("../config/db");
const { consumerOrder } = require("../db/schema");
const { customerRepo, orderRepo, pfiRepo, auditLogRepo } = require("../repositories");
const orderService = require("../services/order.service");
const walletService = require("../services/wallet.service");
const { NATIVE_TRANSPORT, closeDb } = require("./helpers");
const { seedState, seedProduct, seedPrice, seedDepot, seedPfi } = require("./liveFixtures");

const PORTAL_AUTH = "/api/customer/auth";
const ORDERS = "/api/customer/orders";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();

const UNIT_PRICE = 100;
const QTY = 20000;
const TOTAL = UNIT_PRICE * QTY;

// LIVE STATUS MODEL: consumer_order.status has no "expired" value at all —
// Expired writes live "canceled", so a lapsed order READS BACK as Cancelled.
// Which of the two it was survives only in the sman.audit_logs row (action
// "order.expired") — see services/orderStatus.service.js's header comment.
// The assertions below therefore check "Cancelled + an order.expired audit
// row" wherever the old schema showed a distinct Expired status.
const assertLapsed = async (orderId) => {
  const order = await orderRepo.findById(orderId);
  assert.equal(order.status, "Cancelled", "a lapsed order reads back as Cancelled (no live 'expired' status)");
  const events = await auditLogRepo.findByEntity("order", orderId);
  const expired = events.find((e) => e.action === "order.expired");
  assert.ok(expired, "the audit trail records the lapse as an expiry, not a human cancel");
  return { order, expired };
};

async function registerActiveCustomer(tag) {
  const phone = `+234816${String(RUN).slice(-6)}${tag}`;
  const reg = await request(app).post(`${PORTAL_AUTH}/register`).send({ name: `Exp ${tag}`, phone });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const ver = await request(app)
    .post(`${PORTAL_AUTH}/verify-otp`)
    .set(NATIVE_TRANSPORT)
    .send({ phone, code: DEV_CODE });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  const customer = await customerRepo.findByPhone(phone);
  // No per-customer virtual account setup any more — placeOrder pays into the
  // depot's own bank account (manual deposit only), linked in before().
  return { customer, accessToken: ver.body.data.accessToken };
}

describe("order expiry — unpaid orders lapse after the window, distinct from cancellation", () => {
  let depotId;
  let productId;
  let pfiId;
  let stateName;

  before(async () => {
    // Live model: pricing and sellable stock are STATE-scoped; the depot joins
    // via location === state name and needs an Active bank account linked.
    const state = await seedState();
    stateName = state.name;

    const depot = await seedDepot({ location: state.name, bankAccount: true });
    depotId = depot.id;

    const product = await seedProduct();
    productId = product.id;

    await seedPrice(productId, state.id, { price: String(UNIT_PRICE) });

    const pfi = await seedPfi({ productId, locationId: state.id, startingQtyLitres: "5000000.00" });
    pfiId = pfi.id;
  });

  after(async () => {
    await closeDb();
  });

  const placeOrder = (accessToken) =>
    request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ depot: depotId, product: productId, state: stateName, quantity: QTY, deliveryType: "pickup", companyName: "Expiry Co" });

  /** Move an order's creation time into the past so the sweep sees it as stale. */
  const backdate = (orderId, hoursAgo) =>
    db
      .update(consumerOrder)
      .set({ createdAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString() })
      .where(eq(consumerOrder.id, orderId));

  test("a Pending order older than the window is expired and its reserved stock returned", async () => {
    const { customer, accessToken } = await registerActiveCustomer("1");
    const placed = await placeOrder(accessToken);
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const orderId = placed.body.data.order.id;

    // The order reserved its litres on the PFI at placement (SUM of
    // consumer_pfimovement rows — no stored soldQtyLitres column live).
    const beforeSold = await pfiRepo.getSoldQty(pfiId);
    assert.equal(beforeSold >= QTY, true, "stock was reserved at placement");

    await backdate(orderId, 25); // default window is 24h
    const expired = await orderService.expireStaleOrders();
    assert.equal(expired >= 1, true, "the sweep expired at least this order");

    const { order } = await assertLapsed(orderId);
    assert.equal(order.paymentStatus, "Unpaid", "an unpaid order stays unpaid");
    // NOTE: the old expiredAt column is gone — consumer_order has no such
    // column and no live home for the lapse moment (order.repository.js
    // header). The audit row asserted in assertLapsed is the surviving record.

    const afterSold = await pfiRepo.getSoldQty(pfiId);
    assert.equal(afterSold, beforeSold - QTY, "the reserved litres were returned to the pool");

    // Expiry never touches the wallet (there was no hold on an unpaid order).
    assert.equal(await customerRepo.getBalance(customer.id), 0, "wallet untouched");
  });

  test("a fresh order (within the window) is left alone", async () => {
    const { accessToken } = await registerActiveCustomer("2");
    const placed = await placeOrder(accessToken);
    const orderId = placed.body.data.order.id;

    await orderService.expireStaleOrders();

    assert.equal((await orderRepo.findById(orderId)).status, "Pending", "still Pending");
  });

  test("a Paid order is never expired, even when old", async () => {
    const { customer, accessToken } = await registerActiveCustomer("3");
    await walletService.credit({ customerId: customer.id, amount: TOTAL, description: "test funding", reference: `EXP3-${RUN}` });
    const placed = await placeOrder(accessToken);
    const orderId = placed.body.data.order.id;

    await orderService.payOrder({ orderId, actor: { type: "system" } });
    await backdate(orderId, 100);
    await orderService.expireStaleOrders();

    // Paid orders are Released the moment they are paid, and neither status is
    // reachable from the expiry sweep — only Pending lapses.
    assert.equal((await orderRepo.findById(orderId)).status, "Released", "a funded order never lapses");
  });

  test("the window is set by ORDER_EXPIRY_HOURS", async () => {
    const original = process.env.ORDER_EXPIRY_HOURS;
    try {
      process.env.ORDER_EXPIRY_HOURS = "48";
      const { accessToken } = await registerActiveCustomer("4");
      const placed = await placeOrder(accessToken);
      const orderId = placed.body.data.order.id;

      // 30h old, under the 48h window — untouched.
      await backdate(orderId, 30);
      await orderService.expireStaleOrders();
      assert.equal((await orderRepo.findById(orderId)).status, "Pending", "under the window: Pending");

      // 50h old, past the 48h window — expired.
      await backdate(orderId, 50);
      await orderService.expireStaleOrders();
      await assertLapsed(orderId);
    } finally {
      if (original === undefined) delete process.env.ORDER_EXPIRY_HOURS;
      else process.env.ORDER_EXPIRY_HOURS = original;
    }
  });

  test("paying a lapsed order expires it and refuses (409), without debiting the wallet", async () => {
    const { customer, accessToken } = await registerActiveCustomer("5");
    await walletService.credit({ customerId: customer.id, amount: TOTAL, description: "test funding", reference: `EXP5-${RUN}` });
    const placed = await placeOrder(accessToken);
    const orderId = placed.body.data.order.id;

    await backdate(orderId, 25);

    // The old assertion also required /expired/i in the message. That copy is
    // unreachable now: payOrder's `status === "Expired"` guard
    // (services/order.service.js:980) can never match, because a lapsed order
    // reads back as Cancelled — the refusal falls through to the generic
    // "Cannot pay an order in Cancelled status". Reported as a gap; the
    // business property (409 + flagged lapsed + wallet untouched) still holds.
    await assert.rejects(
      () => orderService.payOrder({ orderId, actor: { type: "system" } }),
      (err) => err.status === 409,
      "paying a lapsed order is refused"
    );

    await assertLapsed(orderId);
    assert.equal(await customerRepo.getBalance(customer.id), TOTAL, "wallet not debited");
  });

  test("expiring an already-expired order is refused by the state machine (idempotent sweep)", async () => {
    const { accessToken } = await registerActiveCustomer("6");
    const placed = await placeOrder(accessToken);
    const orderId = placed.body.data.order.id;

    await backdate(orderId, 25);
    await orderService.expireOrder(orderId);
    await assertLapsed(orderId);

    await assert.rejects(
      () => orderService.expireOrder(orderId),
      (err) => err.status === 409,
      "a second expire is a no-op the sweep swallows"
    );
  });
});
