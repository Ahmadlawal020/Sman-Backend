// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
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
  const phone = `+234815${String(RUN).slice(-5)}${String(tag).padStart(2, "0")}`;
  const reg = await request(app).post(`${PORTAL_AUTH}/register`).send({ name: `DNG Cust ${tag}`, phone });
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

describe("customer portal — pay an approved Dangote quote from wallet", () => {
  after(async () => {
    await closeDb();
  });

  test("approved + unpaid → paid, wallet debited", async () => {
    const { customer, accessToken } = await registerActiveCustomer(1);
    const req = await seedRequest(customer.id);
    await customerRepo.creditBalance(customer.id, TOTAL);

    const res = await request(app)
      .post(`${DANGOTE}/${req.id}/pay`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.request.paymentStatus, "Paid");
    assert.equal(res.body.data.request.paymentMode, "wallet");
    assert.equal(Number((await customerRepo.findById(customer.id)).balance), 0, "wallet spent");
  });

  test("a foreign request is a 404, not another customer's paid order", async () => {
    const owner = await registerActiveCustomer(2);
    const intruder = await registerActiveCustomer(3);
    const req = await seedRequest(owner.customer.id);
    await customerRepo.creditBalance(intruder.customer.id, TOTAL);

    const res = await request(app)
      .post(`${DANGOTE}/${req.id}/pay`)
      .set("Authorization", `Bearer ${intruder.accessToken}`)
      .send({});

    assert.equal(res.status, 404, JSON.stringify(res.body));
    // Owner's request untouched.
    assert.equal((await dangoteOrderRequestRepo.findById(req.id)).paymentStatus, "Unpaid");
  });

  test("an already-paid request → 409", async () => {
    const { customer, accessToken } = await registerActiveCustomer(4);
    const req = await seedRequest(customer.id, { paymentStatus: "Paid" });

    const res = await request(app)
      .post(`${DANGOTE}/${req.id}/pay`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    assert.equal(res.status, 409, JSON.stringify(res.body));
  });

  test("a request not yet Approved → 409", async () => {
    const { customer, accessToken } = await registerActiveCustomer(5);
    const req = await seedRequest(customer.id, { status: "Pending Review" });
    await customerRepo.creditBalance(customer.id, TOTAL);

    const res = await request(app)
      .post(`${DANGOTE}/${req.id}/pay`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    assert.equal(res.status, 409, JSON.stringify(res.body));
  });

  test("insufficient balance → 400 with required vs available", async () => {
    const { customer, accessToken } = await registerActiveCustomer(6);
    const req = await seedRequest(customer.id);
    // No credit — balance is 0.

    const res = await request(app)
      .post(`${DANGOTE}/${req.id}/pay`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /Insufficient wallet balance/);
    assert.equal((await dangoteOrderRequestRepo.findById(req.id)).paymentStatus, "Unpaid", "not marked paid");
  });
});
