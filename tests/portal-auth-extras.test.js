// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { NATIVE_TRANSPORT, closeDb } = require("./helpers");

const PORTAL_AUTH = "/api/customer/auth";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();

async function registerAndVerify(tag) {
  const phone = `+234818${String(RUN).slice(-6)}${tag}`;
  const reg = await request(app).post(`${PORTAL_AUTH}/register`).send({ name: `Extra ${tag}`, phone });
  const ver = await request(app)
    .post(`${PORTAL_AUTH}/verify-otp`)
    .set(NATIVE_TRANSPORT)
    .send({ phone, code: DEV_CODE });
  return { phone, reg, accessToken: ver.body.data.accessToken };
}

describe("portal auth — dev OTP surfacing and email persistence", () => {
  after(async () => {
    await closeDb();
  });

  test("register surfaces the dev code in dev mode, for SMS-less testing", async () => {
    const { reg } = await registerAndVerify("1");
    // The suite runs with OTP_DEV_MODE=true, so the fixed code is exposed.
    assert.equal(reg.body.devCode, DEV_CODE, "the OTP screen can read the code off this");
  });

  test("request-otp also surfaces it for a known number", async () => {
    const { phone } = await registerAndVerify("2");
    const res = await request(app).post(`${PORTAL_AUTH}/request-otp`).send({ phone });
    assert.equal(res.body.devCode, DEV_CODE);
  });

  test("setting email+password persists the email on the customer", async () => {
    const { accessToken } = await registerAndVerify("3");
    const email = `extra${RUN}@obifuels.test`;
    const set = await request(app)
      .post(`${PORTAL_AUTH}/password`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ email, password: "a-strong-passw0rd" });
    assert.equal(set.status, 200, JSON.stringify(set.body));

    // A fresh /me now carries the email — not only the identity row.
    const me = await request(app).get(`${PORTAL_AUTH}/me`).set("Authorization", `Bearer ${accessToken}`);
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.data.customer.email, email, "the account email is the sign-in email");
  });
});
