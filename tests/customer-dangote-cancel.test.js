// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { customerRepo, dangoteOrderRequestRepo } = require("../repositories");
const { NATIVE_TRANSPORT, closeDb } = require("./helpers");

const PORTAL_AUTH = "/api/customer/auth";
const DANGOTE = "/api/customer/dangote-orders";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();

const TOTAL = 5_000_000;

/** Register a customer, prove the phone (→ Active), return the row + token. */
async function registerActiveCustomer(tag) {
  const phone = `+234816${String(RUN).slice(-5)}${String(tag).padStart(2, "0")}`;
  const reg = await request(app).post(`${PORTAL_AUTH}/register`).send({ name: `DNG Cancel ${tag}`, phone });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const ver = await request(app)
    .post(`${PORTAL_AUTH}/verify-otp`)
    .set(NATIVE_TRANSPORT)
    .send({ phone, code: DEV_CODE });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  const customer = await customerRepo.findByPhone(phone);
  return { customer, accessToken: ver.body.data.accessToken };
}

/** Seed one Dangote request directly, skipping the staff review flow. */
async function seedRequest(customerId, { status = "Approved", paymentStatus = "Unpaid", totalAmount = TOTAL } = {}) {
  const requestNumber = await dangoteOrderRequestRepo.generateRequestNumber();
  return dangoteOrderRequestRepo.create({
    requestNumber,
    customerId,
    product: "Dangote Cement",
    quantity: 100,
    quantityUnit: "Tons",
    deliveryAddress: "1 Test Road, Lagos",
    status,
    paymentStatus,
    totalAmount: String(totalAmount),
  });
}

describe("customer portal — cancel (withdraw) a Dangote quote request", () => {
  after(async () => {
    await closeDb();
  });

  test("Pending Review → Cancelled", async () => {
    const { customer, accessToken } = await registerActiveCustomer(1);
    const req = await seedRequest(customer.id, { status: "Pending Review", paymentStatus: "Unpaid" });

    const res = await request(app)
      .post(`${DANGOTE}/${req.id}/cancel`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.request.status, "Cancelled");
    assert.equal((await dangoteOrderRequestRepo.findById(req.id)).status, "Cancelled");
  });

  test("Approved + Unpaid → Cancelled", async () => {
    const { customer, accessToken } = await registerActiveCustomer(2);
    const req = await seedRequest(customer.id, { status: "Approved", paymentStatus: "Unpaid" });

    const res = await request(app)
      .post(`${DANGOTE}/${req.id}/cancel`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.request.status, "Cancelled");
  });

  test("a paid request cannot be cancelled → 409, untouched", async () => {
    const { customer, accessToken } = await registerActiveCustomer(3);
    const req = await seedRequest(customer.id, { status: "Approved", paymentStatus: "Paid" });

    const res = await request(app)
      .post(`${DANGOTE}/${req.id}/cancel`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    assert.equal(res.status, 409, JSON.stringify(res.body));
    const after = await dangoteOrderRequestRepo.findById(req.id);
    assert.equal(after.status, "Approved", "status untouched");
    assert.equal(after.paymentStatus, "Paid");
  });

  test("an already-cancelled request → 409", async () => {
    const { customer, accessToken } = await registerActiveCustomer(4);
    const req = await seedRequest(customer.id, { status: "Cancelled", paymentStatus: "Unpaid" });

    const res = await request(app)
      .post(`${DANGOTE}/${req.id}/cancel`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    assert.equal(res.status, 409, JSON.stringify(res.body));
  });

  test("a staff-rejected request → 409", async () => {
    const { customer, accessToken } = await registerActiveCustomer(5);
    const req = await seedRequest(customer.id, { status: "Rejected", paymentStatus: "Unpaid" });

    const res = await request(app)
      .post(`${DANGOTE}/${req.id}/cancel`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    assert.equal(res.status, 409, JSON.stringify(res.body));
  });

  test("a foreign request is a 404, and stays untouched", async () => {
    const owner = await registerActiveCustomer(6);
    const intruder = await registerActiveCustomer(7);
    const req = await seedRequest(owner.customer.id, { status: "Approved", paymentStatus: "Unpaid" });

    const res = await request(app)
      .post(`${DANGOTE}/${req.id}/cancel`)
      .set("Authorization", `Bearer ${intruder.accessToken}`)
      .send({});

    assert.equal(res.status, 404, JSON.stringify(res.body));
    assert.equal((await dangoteOrderRequestRepo.findById(req.id)).status, "Approved", "owner's request untouched");
  });

  test("cancelling requires authentication", async () => {
    const res = await request(app).post(`${DANGOTE}/1/cancel`).send({});
    assert.equal(res.status, 401);
  });

  // The race guard, tested at the repository layer so it is deterministic rather
  // than dependent on interleaving two live requests: cancelIfWithdrawable is the
  // atomic WHERE that a concurrent wallet payment must lose to.
  describe("cancelIfWithdrawable — the atomic race guard", () => {
    test("cancels an Approved + Unpaid request owned by the customer", async () => {
      const { customer } = await registerActiveCustomer(8);
      const req = await seedRequest(customer.id, { status: "Approved", paymentStatus: "Unpaid" });

      const row = await dangoteOrderRequestRepo.cancelIfWithdrawable(req.id, customer.id);
      assert.ok(row, "returns the updated row");
      assert.equal(row.status, "Cancelled");
    });

    test("cancels a Pending Review request", async () => {
      const { customer } = await registerActiveCustomer(9);
      const req = await seedRequest(customer.id, { status: "Pending Review", paymentStatus: "Unpaid" });

      const row = await dangoteOrderRequestRepo.cancelIfWithdrawable(req.id, customer.id);
      assert.ok(row);
      assert.equal(row.status, "Cancelled");
    });

    test("refuses (null) once the request is Paid — the pay/cancel race", async () => {
      const { customer } = await registerActiveCustomer(10);
      // Approved but ALREADY paid: this is the state a concurrent pay leaves
      // behind. The guard must match zero rows, not overwrite it to Cancelled.
      const req = await seedRequest(customer.id, { status: "Approved", paymentStatus: "Paid" });

      const row = await dangoteOrderRequestRepo.cancelIfWithdrawable(req.id, customer.id);
      assert.equal(row, null, "a paid request is not cancellable");
      assert.equal((await dangoteOrderRequestRepo.findById(req.id)).status, "Approved", "left untouched");
    });

    test("refuses (null) for a terminal (Rejected) request", async () => {
      const { customer } = await registerActiveCustomer(11);
      const req = await seedRequest(customer.id, { status: "Rejected", paymentStatus: "Unpaid" });

      const row = await dangoteOrderRequestRepo.cancelIfWithdrawable(req.id, customer.id);
      assert.equal(row, null);
    });

    test("refuses (null) for another customer's request", async () => {
      const owner = await registerActiveCustomer(12);
      const intruder = await registerActiveCustomer(13);
      const req = await seedRequest(owner.customer.id, { status: "Approved", paymentStatus: "Unpaid" });

      const row = await dangoteOrderRequestRepo.cancelIfWithdrawable(req.id, intruder.customer.id);
      assert.equal(row, null, "ownership is part of the atomic guard");
      assert.equal((await dangoteOrderRequestRepo.findById(req.id)).status, "Approved");
    });
  });
});
