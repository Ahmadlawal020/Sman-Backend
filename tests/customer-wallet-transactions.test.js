// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { customerRepo } = require("../repositories");
const walletService = require("../services/wallet.service");
const { NATIVE_TRANSPORT, closeDb } = require("./helpers");

const PORTAL_AUTH = "/api/customer/auth";
const WALLET = "/api/customer/wallet";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();

async function registerActiveCustomer(tag) {
  const phone = `+234818${String(RUN).slice(-5)}${String(tag).padStart(2, "0")}`;
  const reg = await request(app).post(`${PORTAL_AUTH}/register`).send({ name: `Wal Cust ${tag}`, phone });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const ver = await request(app)
    .post(`${PORTAL_AUTH}/verify-otp`)
    .set(NATIVE_TRANSPORT)
    .send({ phone, code: DEV_CODE });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  const customer = await customerRepo.findByPhone(phone);
  return { customer, accessToken: ver.body.data.accessToken };
}

describe("customer portal — wallet transaction history", () => {
  after(async () => {
    await closeDb();
  });

  test("history requires authentication", async () => {
    const res = await request(app).get(`${WALLET}/transactions`);
    assert.equal(res.status, 401, JSON.stringify(res.body));
  });

  test("a fresh customer has an empty ledger", async () => {
    const { accessToken } = await registerActiveCustomer(1);
    const res = await request(app)
      .get(`${WALLET}/transactions`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.data, []);
    assert.equal(res.body.data.pagination.total, 0);
  });

  test("credits and debits appear newest-first with type/amount/ref/at", async () => {
    const { customer, accessToken } = await registerActiveCustomer(2);
    await walletService.credit({ customerId: customer.id, amount: 500000, description: "Top up", reference: `WT-CR-${RUN}` });
    await walletService.debit({ customerId: customer.id, amount: 200000, description: "Order pay", reference: `WT-DR-${RUN}` });

    const res = await request(app)
      .get(`${WALLET}/transactions`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const rows = res.body.data.data;
    assert.equal(rows.length, 2);
    // Newest first — the debit was the last write.
    assert.equal(rows[0].type, "debit");
    assert.equal(rows[0].amount, 200000);
    assert.equal(rows[0].ref, `WT-DR-${RUN}`);
    assert.ok(rows[0].at, "carries a timestamp");
    assert.equal(rows[1].type, "credit");
    assert.equal(rows[1].amount, 500000);
    assert.equal(res.body.data.pagination.total, 2);
  });

  test("the ledger is scoped — one customer never sees another's", async () => {
    const a = await registerActiveCustomer(3);
    const b = await registerActiveCustomer(4);
    await walletService.credit({ customerId: a.customer.id, amount: 100000, description: "A only", reference: `WT-A-${RUN}` });

    const res = await request(app)
      .get(`${WALLET}/transactions`)
      .set("Authorization", `Bearer ${b.accessToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.data, []);
  });

  test("limit paginates the ledger", async () => {
    const { customer, accessToken } = await registerActiveCustomer(5);
    await walletService.credit({ customerId: customer.id, amount: 1000, description: "c1", reference: `WT-P1-${RUN}` });
    await walletService.credit({ customerId: customer.id, amount: 2000, description: "c2", reference: `WT-P2-${RUN}` });
    await walletService.credit({ customerId: customer.id, amount: 3000, description: "c3", reference: `WT-P3-${RUN}` });

    const res = await request(app)
      .get(`${WALLET}/transactions?limit=2&page=1`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.data.length, 2);
    assert.equal(res.body.data.pagination.total, 3);
    assert.equal(res.body.data.pagination.pages, 2);
    assert.equal(res.body.data.pagination.limit, 2);
  });
});
