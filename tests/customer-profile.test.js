// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { customerRepo } = require("../repositories");
const { NATIVE_TRANSPORT, closeDb } = require("./helpers");

const PORTAL_AUTH = "/api/customer/auth";
const PROFILE = "/api/customer/profile";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();

async function registerCustomer(tag) {
  const phone = `+234814${String(RUN).slice(-6)}${tag}`;
  const reg = await request(app)
    .post(`${PORTAL_AUTH}/register`)
    .send({ name: `Profile ${tag}`, phone, companyName: "Profile Co" });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const ver = await request(app)
    .post(`${PORTAL_AUTH}/verify-otp`)
    .set(NATIVE_TRANSPORT)
    .send({ phone, code: DEV_CODE });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  const customer = await customerRepo.findByPhone(phone);
  return { customer, accessToken: ver.body.data.accessToken, phone };
}

describe("customer portal — own profile", () => {
  after(async () => {
    await closeDb();
  });

  test("requires authentication", async () => {
    const res = await request(app).get(PROFILE);
    assert.equal(res.status, 401);
  });

  test("GET returns the customer profile shape", async () => {
    // Post-cutover contract: consumer_customer has no address column and
    // Paystack DVAs are disabled (manual deposit only), so `address` is always
    // "" and `virtualAccount` is always null. Both keys are deliberately kept
    // in the response shape — see the profilePayload comment in
    // controllers/portal/profile.controller.js — so clients don't need a
    // contract change if either feature returns.
    const { accessToken } = await registerCustomer("1");

    const res = await request(app).get(PROFILE).set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok("address" in res.body.data.customer, "address key kept in the shape");
    assert.equal(res.body.data.customer.address, "", "no live address column — always empty");
    assert.equal(res.body.data.customer.companyName, "Profile Co");
    assert.ok(!("balance" in res.body.data.customer), "internal fields stay internal");
  });

  test("GET reports a null virtual account always (DVA funding disabled)", async () => {
    const { accessToken } = await registerCustomer("2");
    const res = await request(app).get(PROFILE).set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.virtualAccount, null);
  });

  test("PATCH updates the allowed text fields", async () => {
    const { accessToken } = await registerCustomer("3");
    const res = await request(app)
      .patch(PROFILE)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Renamed Buyer", email: "buyer@profile.test", address: "New address" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.customer.name, "Renamed Buyer");
    assert.equal(res.body.data.customer.email, "buyer@profile.test");
    // No live address column: the repo consciously discards `address`, so the
    // write is accepted (other fields land) but the value is not persisted.
    assert.equal(res.body.data.customer.address, "");
  });

  test("PATCH refuses fields a customer must never write", async () => {
    const { customer, accessToken } = await registerCustomer("4");
    const res = await request(app)
      .patch(PROFILE)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "Active", balance: "9999999", phone: "+2348000000000" });
    // The schema strips/rejects unknown keys; with nothing allowed left, the
    // request is a validation error, not a silent no-op write.
    assert.equal(res.status, 400, JSON.stringify(res.body));
    const fresh = await customerRepo.findById(customer.id);
    assert.notEqual(fresh.phone, "+2348000000000", "phone is never writable here");
  });

  test("PATCH with an empty body is refused", async () => {
    const { accessToken } = await registerCustomer("5");
    const res = await request(app)
      .patch(PROFILE)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});
    assert.equal(res.status, 400);
  });
});
