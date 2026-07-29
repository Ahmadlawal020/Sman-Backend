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
const PIN = "482913";

async function registerAndVerify(tag, { trustDevice } = {}) {
  const phone = `+234817${String(RUN).slice(-6)}${tag}`;
  await request(app).post(`${PORTAL_AUTH}/register`).send({ name: `Pin ${tag}`, phone });
  const ver = await request(app)
    .post(`${PORTAL_AUTH}/verify-otp`)
    .set(NATIVE_TRANSPORT)
    .send({ phone, code: DEV_CODE, ...(trustDevice ? { trustDevice: true, deviceName: "Test Device" } : {}) });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  return { phone, body: ver.body.data };
}

describe("phone OTP → trust device → PIN login", () => {
  after(async () => {
    await closeDb();
  });

  test("verify-otp trusts the device only when asked", async () => {
    const plain = await registerAndVerify("1");
    assert.equal(plain.body.deviceToken, undefined, "no device token unless trustDevice is set");

    const trusted = await registerAndVerify("2", { trustDevice: true });
    assert.ok(trusted.body.deviceToken, "trustDevice returns a device token");
  });

  test("a trusted device can then log in by PIN, skipping the OTP", async () => {
    const { phone, body } = await registerAndVerify("3", { trustDevice: true });
    const deviceToken = body.deviceToken;

    const setPin = await request(app)
      .post(`${PORTAL_AUTH}/pin`)
      .set("Authorization", `Bearer ${body.accessToken}`)
      .send({ pin: PIN });
    assert.equal(setPin.status, 200, JSON.stringify(setPin.body));

    const login = await request(app)
      .post(`${PORTAL_AUTH}/login/pin`)
      .set(NATIVE_TRANSPORT)
      .send({ phone, pin: PIN, deviceToken });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.equal(login.body.data.customer.phone, phone, "signed in by PIN, no OTP");
  });

  test("a correct PIN with no trusted device is refused", async () => {
    const { phone, body } = await registerAndVerify("4", { trustDevice: true });
    await request(app)
      .post(`${PORTAL_AUTH}/pin`)
      .set("Authorization", `Bearer ${body.accessToken}`)
      .send({ pin: PIN });

    // Right PIN, right phone, but no device token → still refused.
    const noDevice = await request(app)
      .post(`${PORTAL_AUTH}/login/pin`)
      .send({ phone, pin: PIN, deviceToken: "not-a-real-token" });
    assert.equal(noDevice.status, 401, "a PIN is never a standalone credential");
  });

  test("a wrong PIN on a trusted device is refused", async () => {
    const { phone, body } = await registerAndVerify("5", { trustDevice: true });
    const deviceToken = body.deviceToken;
    await request(app)
      .post(`${PORTAL_AUTH}/pin`)
      .set("Authorization", `Bearer ${body.accessToken}`)
      .send({ pin: PIN });

    const wrong = await request(app)
      .post(`${PORTAL_AUTH}/login/pin`)
      .send({ phone, pin: "000000", deviceToken });
    assert.equal(wrong.status, 401);
  });
});
