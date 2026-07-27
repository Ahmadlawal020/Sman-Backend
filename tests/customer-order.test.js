// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { db } = require("../config/db");
const { depots, products, depotProductPrices, pfis } = require("../db/schema");
const { customerRepo, orderRepo } = require("../repositories");
const { NATIVE_TRANSPORT, closeDb } = require("./helpers");

const PORTAL_AUTH = "/api/customer/auth";
const ORDERS = "/api/customer/orders";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();

const UNIT_PRICE = 100;
const QTY = 20000;
const TOTAL = UNIT_PRICE * QTY;

/**
 * Register a customer, prove the phone (first correct OTP → Active), and seed a
 * virtual account so order creation doesn't reach the external payment provider.
 * Returns the customer row + a native-transport access token.
 */
async function registerActiveCustomer(tag) {
  const phone = `+234813${String(RUN).slice(-6)}${tag}`;
  const reg = await request(app).post(`${PORTAL_AUTH}/register`).send({ name: `Cust ${tag}`, phone });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const ver = await request(app)
    .post(`${PORTAL_AUTH}/verify-otp`)
    .set(NATIVE_TRANSPORT)
    .send({ phone, code: DEV_CODE });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));

  const customer = await customerRepo.findByPhone(phone);
  await customerRepo.update(customer.id, {
    virtualAccountNumber: `VA${tag}${String(RUN).slice(-6)}`,
    virtualAccountBank: "Test Bank",
    virtualAccountName: `SOROMANNIGERI/ C${tag}`,
  });
  return { customer, accessToken: ver.body.data.accessToken };
}

describe("customer portal — a customer places their own order", () => {
  let depotId;
  let productId;

  before(async () => {
    const [depot] = await db
      .insert(depots)
      .values({
        name: "Portal Depot",
        code: `POR${String(RUN).slice(-5)}`,
        address: "1 Rd",
        city: "Lagos",
        state: "Lagos",
        country: "NG",
        postcode: "100001",
        maxCapacity: 10000000,
        establishedYear: "2020",
      })
      .returning();
    depotId = depot.id;

    const [product] = await db
      .insert(products)
      .values({ name: "Portal PMS", sku: `POR-PMS-${String(RUN).slice(-5)}`, category: "PMS" })
      .returning();
    productId = product.id;

    await db.insert(depotProductPrices).values({ depotId, productId, currentPrice: String(UNIT_PRICE) });
    await db.insert(pfis).values({
      pfiNumber: `PFI-POR-${RUN}`,
      status: "active",
      locationId: depotId,
      productId,
      startingQtyLitres: 500000,
      soldQtyLitres: 0,
    });
  });

  after(async () => {
    await closeDb();
  });

  const body = (extra = {}) => ({
    depot: depotId,
    product: productId,
    state: "Lagos",
    quantity: QTY,
    deliveryType: "pickup",
    ...extra,
  });

  test("an unfunded customer's order is created Pending/Unpaid with an account to pay into", async () => {
    const { customer, accessToken } = await registerActiveCustomer("1");

    const res = await request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body());

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.order.customerId, customer.id, "the order is the customer's own");
    assert.equal(res.body.data.order.status, "Pending");
    assert.equal(res.body.data.order.paymentStatus, "Unpaid");
    assert.ok(res.body.data.payment.accountNumber, "an account to transfer into is returned");
  });

  test("a funded wallet pays at creation and the lifecycle advances to Paid", async () => {
    const { customer, accessToken } = await registerActiveCustomer("2");
    await customerRepo.creditBalance(customer.id, TOTAL);

    const res = await request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body());

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.order.paymentStatus, "Paid");
    assert.equal(res.body.data.order.status, "Paid", "wallet payment advanced the lifecycle");
    assert.equal(Number((await customerRepo.findById(customer.id)).balance), 0, "wallet spent");
  });

  test("a customer may choose fleet delivery too, not only pickup", async () => {
    const { accessToken } = await registerActiveCustomer("3");
    const res = await request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body({ deliveryType: "delivery" }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.order.deliveryType, "delivery");
  });

  test("the body cannot smuggle a different customer — the order is always the caller's", async () => {
    const { customer, accessToken } = await registerActiveCustomer("4");
    const victim = await registerActiveCustomer("5");

    const res = await request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body({ customer: victim.customer.id, customerId: victim.customer.id }));

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.order.customerId, customer.id, "ignored the body id, used the token");
  });

  test("placing an order requires authentication", async () => {
    const res = await request(app).post(ORDERS).send(body());
    assert.equal(res.status, 401);
  });

  test("a customer sees their own orders but not another customer's", async () => {
    const a = await registerActiveCustomer("6");
    const b = await registerActiveCustomer("7");

    const placed = await request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${a.accessToken}`)
      .send(body());
    assert.equal(placed.status, 201);
    const orderId = placed.body.data.order.id;

    // A's own list contains it.
    const list = await request(app).get(ORDERS).set("Authorization", `Bearer ${a.accessToken}`);
    assert.equal(list.status, 200);
    assert.ok(
      list.body.data.orders.some((o) => o.id === orderId),
      "the order is in the customer's own list"
    );
    assert.ok(
      list.body.data.orders.every((o) => o.customerId === a.customer.id),
      "the list is scoped to the caller"
    );

    // B cannot read A's order — it reads as 404, never leaks.
    const peek = await request(app)
      .get(`${ORDERS}/${orderId}`)
      .set("Authorization", `Bearer ${b.accessToken}`);
    assert.equal(peek.status, 404, "another customer's order is not visible");

    // A can read it.
    const own = await request(app)
      .get(`${ORDERS}/${orderId}`)
      .set("Authorization", `Bearer ${a.accessToken}`);
    assert.equal(own.status, 200);
    assert.equal(own.body.data.order.id, orderId);
  });
});
