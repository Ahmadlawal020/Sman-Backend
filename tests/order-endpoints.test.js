// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { orderRepo, auditLogRepo } = require("../repositories");
const customerRepo = require("../repositories/customer.repository");
const walletService = require("../services/wallet.service");
const { staffTokenWithRoles, closeDb } = require("./helpers");
const { seedState, seedProduct, seedCustomer, seedOrder } = require("./liveFixtures");

// Sman starting status -> the live consumer_order values that read back as it
// (see utils/orderStatusMapping.js). Orders have no depotId and no stored
// paymentStatus — "Paid" is derived from status alone.
const LIVE_SEED = Object.freeze({
  Pending: { status: "pending" },
  Paid: { status: "paid" },
  Released: { status: "released" },
  Cancelled: { status: "canceled" },
});

const RUN = Date.now();

describe("order lifecycle endpoints — role gates + state machine", () => {
  let stateId;
  let productId;
  let customerId;
  let releaseStaff; // role: release
  let financeStaff; // role: finance
  let adminStaff; // role: admin — holds neither gate
  let superStaff; // role: super_admin — passes both gates

  before(async () => {
    stateId = (await seedState()).id;
    productId = (await seedProduct()).id;
    customerId = (await seedCustomer({ companyName: "Endpoint Co" })).id;

    releaseStaff = await staffTokenWithRoles(["release"], "test-ep-release@soroman.test");
    financeStaff = await staffTokenWithRoles(["finance"], "test-ep-finance@soroman.test");
    adminStaff = await staffTokenWithRoles(["admin"], "test-ep-admin@soroman.test");
    superStaff = await staffTokenWithRoles(["super_admin"], "test-ep-super@soroman.test");
  });

  after(async () => {
    await closeDb();
  });

  const makeOrder = (status = "Pending") =>
    seedOrder({
      customerId,
      stateId,
      productId,
      quantity: 1000,
      price: "100.00",
      ...LIVE_SEED[status],
    });

  // ── release ────────────────────────────────────────────────────────────────

  // KNOWN PRODUCT BUG (left failing on purpose): the manual release endpoint
  // 500s on the live schema. controllers/administration/order.controller.js:196
  // passes `releasedAt: new Date()` into consumer_order.released_at, which is
  // declared timestamp mode:'string' — postgres-js serialises the Date via
  // toString() ("Wed Aug 19 2026 … (West Africa Time)") and Postgres rejects
  // the UPDATE. It also writes the old `releasedBy` key instead of the live
  // released_by_id column (silently dropped). Payment auto-release works
  // (releaseOnPayment passes an ISO string) — only this desk endpoint is broken.
  test("the release desk moves a Paid order to Released, stamping who + when", async () => {
    const order = await makeOrder("Paid");

    const res = await request(app)
      .post(`/api/orders/${order.id}/release`)
      .set("Authorization", `Bearer ${releaseStaff.accessToken}`)
      .send({});

    assert.equal(res.status, 200);
    assert.equal(res.body.data.order.status, "Released");

    const after = await orderRepo.findById(order.id);
    assert.equal(after.status, "Released");
    assert.ok(after.releasedAt, "releasedAt stamped");
    assert.equal(after.releasedById, releaseStaff.staff.id, "released_by_id stamped on the order");

    const events = await auditLogRepo.findByEntity("order", order.id);
    const released = events.find((e) => e.newState === "Released");
    assert.ok(released, "audit row written");
    assert.equal(released.actorStaffId, releaseStaff.staff.id);
  });

  // Fails with the same released_at Date-serialisation 500 as above.
  test("super_admin may also release", async () => {
    const order = await makeOrder("Paid");
    const res = await request(app)
      .post(`/api/orders/${order.id}/release`)
      .set("Authorization", `Bearer ${superStaff.accessToken}`)
      .send({});
    assert.equal(res.status, 200);
  });

  test("a role without the release gate is refused 403", async () => {
    const order = await makeOrder("Paid");
    const res = await request(app)
      .post(`/api/orders/${order.id}/release`)
      .set("Authorization", `Bearer ${adminStaff.accessToken}`)
      .send({});
    assert.equal(res.status, 403);

    const after = await orderRepo.findById(order.id);
    assert.equal(after.status, "Paid", "status unchanged by a refused caller");
  });

  test("releasing an order that is not Paid is refused by the state machine (409)", async () => {
    const order = await makeOrder("Pending");
    const res = await request(app)
      .post(`/api/orders/${order.id}/release`)
      .set("Authorization", `Bearer ${releaseStaff.accessToken}`)
      .send({});
    assert.equal(res.status, 409);
  });

  // ── cancel ───────────────────────────────────────────────────────────────

  test("finance cancels a Paid order and the held funds are returned", async () => {
    const order = await makeOrder("Paid");
    const amount = Number(order.totalPrice);

    // A Paid order holds the customer's funds. seedOrder's insert doesn't
    // place the hold, so do it here — that's what cancel releases. Fund the
    // wallet first so the hold can be taken. (Balance is computed from the
    // sman credit ledger minus active holds — no stored balance column.)
    await walletService.credit({ customerId, amount, description: "test funding", reference: `EPCAN-${RUN}-${order.id}` });
    const startBalance = await customerRepo.getBalance(customerId);
    await walletService.placeHold({ customerId, orderId: order.id, amount, description: "test" });
    assert.equal(
      await customerRepo.getBalance(customerId),
      startBalance - amount,
      "funds are held while the order is Paid"
    );

    const res = await request(app)
      .post(`/api/orders/${order.id}/cancel`)
      .set("Authorization", `Bearer ${financeStaff.accessToken}`)
      .send({ reason: "customer changed their mind" });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.order.status, "Cancelled");

    const after = await orderRepo.findById(order.id);
    assert.equal(after.status, "Cancelled");
    assert.ok(after.cancelledAt, "cancellation moment surfaced (derived — no live column)");

    // consumer_order has no cancelledBy/cancellationReason columns —
    // cancellation is status='canceled', and who/why live ONLY in the audit
    // row now (see repositories/order.repository.js header).
    const events = await auditLogRepo.findByEntity("order", order.id);
    const cancelled = events.find((e) => e.newState === "Cancelled");
    assert.ok(cancelled, "cancel audit row written");
    assert.equal(cancelled.actorStaffId, financeStaff.staff.id, "who cancelled is in the audit trail");
    assert.equal(cancelled.metadata?.reason, "customer changed their mind", "the reason is in the audit trail");

    // releaseHold returns the held money — balance back to before the hold, and
    // no debit/credit ledger churn (the hold is the record).
    assert.equal(
      await customerRepo.getBalance(customerId),
      startBalance,
      "the held funds were returned on cancel"
    );
    const hold = await walletService.findHoldByOrder(order.id);
    assert.equal(hold.status, "released", "the hold is marked released");
  });

  test("a role without the finance gate cannot cancel (403)", async () => {
    const order = await makeOrder("Paid");
    const res = await request(app)
      .post(`/api/orders/${order.id}/cancel`)
      .set("Authorization", `Bearer ${adminStaff.accessToken}`)
      .send({});
    assert.equal(res.status, 403);

    const after = await orderRepo.findById(order.id);
    assert.equal(after.status, "Paid", "status unchanged by a refused caller");
  });

  test("cancelling an already-cancelled order is refused 409, so no double refund", async () => {
    const order = await makeOrder("Cancelled");
    const res = await request(app)
      .post(`/api/orders/${order.id}/cancel`)
      .set("Authorization", `Bearer ${financeStaff.accessToken}`)
      .send({});
    assert.equal(res.status, 409);
  });

  // ── H1: the raw status setter is gone ──────────────────────────────────────

  test("the removed raw PUT status setter is not routable", async () => {
    const order = await makeOrder("Pending");
    const res = await request(app)
      .put(`/api/orders/${order.id}`)
      .set("Authorization", `Bearer ${superStaff.accessToken}`)
      .send({ status: "Completed" });
    assert.equal(res.status, 404, "PUT /orders/:id no longer exists");

    const after = await orderRepo.findById(order.id);
    assert.equal(after.status, "Pending", "status could not be force-set");
  });
});
