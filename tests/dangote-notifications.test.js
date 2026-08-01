// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { onEvent } = require("../services/events");
const { customerRepo } = require("../repositories");
const { NATIVE_TRANSPORT, closeDb } = require("./helpers");

const PORTAL_AUTH = "/api/customer/auth";
const DD = "/api/customer/dangote-delivery-orders";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();

const auth = (token) => ({ Authorization: `Bearer ${token}`, ...NATIVE_TRANSPORT });
const DETAILS = {
  product: "PMS",
  quantity: 5000,
  deliveryAddress: "1 Test Rd, Lagos",
  deliveryState: "Lagos",
  contactPerson: "Test Person",
  contactPhone: "+2348011122233",
};

async function registerActiveCustomer() {
  const phone = `+234813${String(RUN).slice(-7)}`;
  const reg = await request(app).post(`${PORTAL_AUTH}/register`).send({ name: "Notify Cust", phone });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const ver = await request(app)
    .post(`${PORTAL_AUTH}/verify-otp`)
    .set(NATIVE_TRANSPORT)
    .send({ phone, code: DEV_CODE });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  const customer = await customerRepo.findByPhone(phone);
  return { customer, token: ver.body.data.accessToken };
}

// The audit consumer reads entityType / entityId / actor off the event; the
// notification consumer reacts to `to`. Both hang off this one event, so
// asserting its shape is what keeps audit + notifications wired.
describe("dangote delivery — status-change event feeds audit + notifications", () => {
  let me;
  const captured = [];

  before(async () => {
    me = await registerActiveCustomer();
    onEvent("dangote_delivery.status_changed", (p) => captured.push(p));
  });

  after(async () => {
    await closeDb();
  });

  test("a transition emits entityType / entityId / actor and the target status", async () => {
    const created = await request(app).post(DD).set(auth(me.token)).send(DETAILS);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const order = created.body.data.order;

    // DRAFT → CANCELLED is a real transition (no license/signature needed).
    const cancel = await request(app).post(`${DD}/${order.id}/cancel`).set(auth(me.token));
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));

    // Bus handlers run on a microtask; let them settle.
    await new Promise((r) => setImmediate(r));

    const evt = captured.find((e) => e.to === "CANCELLED" && e.requestNumber === order.requestNumber);
    assert.ok(evt, "a CANCELLED status_changed event should have been emitted");
    assert.equal(evt.entityType, "dangote_delivery_order", "audit entityType");
    assert.equal(String(evt.entityId), String(order.id), "audit entityId = order id");
    assert.deepEqual(evt.actor, { type: "customer", id: me.customer.id }, "audit actor");
    assert.equal(evt.customerId, me.customer.id);
  });
});
