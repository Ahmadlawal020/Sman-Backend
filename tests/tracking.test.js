// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { db } = require("../config/db");
const { consumerOrder, consumerTruckallocation } = require("../db/schema");
const { eq } = require("drizzle-orm");
const { orderRepo } = require("../repositories");
const { NATIVE_TRANSPORT, closeDb } = require("./helpers");
const { seedState, seedProduct, seedPrice, seedDepot, seedPfi, now } = require("./liveFixtures");

const PORTAL_AUTH = "/api/customer/auth";
const ORDERS = "/api/customer/orders";
const TRACK = "/api/tracking";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();
const QTY = 30000;

async function activeCustomer(tag) {
  const phone = `+234816${String(RUN).slice(-6)}${tag}`;
  await request(app).post(`${PORTAL_AUTH}/register`).send({ name: `Track ${tag}`, phone });
  const ver = await request(app)
    .post(`${PORTAL_AUTH}/verify-otp`)
    .set(NATIVE_TRANSPORT)
    .send({ phone, code: DEV_CODE });
  // No wallet funding needed — placing an order never touches the wallet;
  // payment is a separate manual action these tests drive via raw status
  // updates. The Paystack DVA fields the old fixture stamped have no live
  // consumer_customer columns at all (manual deposit only now).
  return { accessToken: ver.body.data.accessToken };
}

describe("public order tracking", () => {
  let depotId;
  let productId;
  let productName;
  let stateName;

  before(async () => {
    // Live model: pricing/stock are STATE-scoped. The depot joins the catalog
    // and order path via location === state name; sellable stock comes from an
    // active PFI whose locationId is the state id.
    const state = await seedState({ name: `Track State ${RUN}` });
    stateName = state.name;

    // placeOrder pays into the depot's own bank account (manual deposit only —
    // no Paystack DVA), so every order-placing test depot needs one linked.
    const depot = await seedDepot({ name: `Track Depot ${RUN}`, location: state.name, bankAccount: true });
    depotId = depot.id;

    const product = await seedProduct({ name: `Track PMS ${RUN}` });
    productId = product.id;
    productName = product.name;

    await seedPrice(productId, state.id, { price: "900.00" });
    await seedPfi({ productId, locationId: state.id });
  });

  after(async () => {
    await closeDb();
  });

  const place = async (accessToken) => {
    const res = await request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ depot: depotId, product: productId, state: stateName, quantity: QTY, deliveryType: "pickup", companyName: "Tracking Co" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data.order;
  };

  /** Two live truck allocations on an order: one departed, one only ticketed. */
  const seedLoads = async (orderId) => {
    const orderProductId = await orderRepo.getLineItemId(orderId);
    await db.insert(consumerTruckallocation).values([
      {
        orderId,
        orderProductId,
        truckNumber: 1,
        plateNumber: "LAG-T1",
        quantity: "15000",
        ticketNumber: `TKT-TRK-${RUN}-${orderId}-T1`,
        ticketStatus: "completed",
        driverName: "Ada Private",
        createdAt: now(),
        updatedAt: now(),
      },
      {
        orderId,
        orderProductId,
        truckNumber: 2,
        plateNumber: "LAG-T2",
        quantity: "15000",
        ticketNumber: `TKT-TRK-${RUN}-${orderId}-T2`,
        ticketStatus: "generated",
        driverName: "Uche Private",
        createdAt: now(),
        updatedAt: now(),
      },
    ]);
  };

  test("an unknown reference is a 404", async () => {
    const res = await request(app).get(`${TRACK}/ORD-DOESNOTEXIST`);
    assert.equal(res.status, 404);
  });

  test("a fresh order tracks at 'received' with movement only — no price or identity", async () => {
    const { accessToken } = await activeCustomer("1");
    const order = await place(accessToken);

    const res = await request(app).get(`${TRACK}/${encodeURIComponent(order.orderNumber)}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const t = res.body.data.tracked;

    assert.equal(t.ref, order.orderNumber);
    assert.equal(t.stage, "received");
    // consumer_order carries no depot at all (only pfiId → state), so the
    // public feed deliberately drops the depot name rather than guessing one
    // — see services/tracking.service.js trackByRef.
    assert.equal(t.depotName, "");
    assert.equal(t.lines[0].quantity, QTY);
    assert.equal(t.lines[0].name, productName, "the product line survives the cutover");
    assert.equal(t.lines[0].unit, "Liters");
    assert.ok(t.reached.received, "received is timestamped");
    assert.equal(t.reached.released, undefined, "later stages are not reached yet");

    // The privacy contract: nothing here may reveal price or who the buyer is.
    // Scan everything EXCEPT the legitimately-public reference and the movement
    // timestamps — those carry random digit runs (a `.900` millisecond) that
    // would otherwise trip the short "900" price pattern.
    const { ref, placedAt, reached, ...privacyScan } = t;
    const blob = JSON.stringify(privacyScan);
    assert.ok(!/price|total|900|27000000/i.test(blob), `no price or total leaks: ${blob}`);
    assert.ok(!/Track 1|virtualAccount|balance|company/i.test(blob), "no buyer identity leaks");
  });

  test("stage advances with the order's lifecycle timestamps", async () => {
    const { accessToken } = await activeCustomer("2");
    const order = await place(accessToken);

    // Live vocabulary: status is Django's lowercase set; there is no
    // paymentStatus column — payment_confirmed_at is the paid signal.
    await db
      .update(consumerOrder)
      .set({ status: "paid", paymentConfirmedAt: now() })
      .where(eq(consumerOrder.id, order.id));

    const res = await request(app).get(`${TRACK}/${encodeURIComponent(order.orderNumber)}`);
    const t = res.body.data.tracked;
    assert.equal(t.stage, "processing", "paid-but-not-released reads as processing");
    assert.ok(t.reached.payment_confirmed, "payment_confirmed is timestamped");
    assert.ok(t.reached.processing, "processing is timestamped");
  });

  test("the lookup is case-insensitive and tolerates surrounding space", async () => {
    const { accessToken } = await activeCustomer("3");
    const order = await place(accessToken);
    const res = await request(app).get(
      `${TRACK}/${encodeURIComponent(`  ${order.orderNumber.toLowerCase()}  `)}`
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.tracked.ref, order.orderNumber);
  });

  test("the loading stage shows each truck and its status — plates only, no driver", async () => {
    const { accessToken } = await activeCustomer("5");
    const order = await place(accessToken);
    await db
      .update(consumerOrder)
      .set({
        status: "loaded",
        paymentConfirmedAt: now(),
        releasedAt: now(),
        loadingDatetime: now(),
      })
      .where(eq(consumerOrder.id, order.id));
    // One truck loaded and away ("completed" — the allocation's terminal
    // ticket_status), one only ticketed ("generated"). Progress is counted
    // off "completed": a merely ticketed truck may not have loaded yet.
    await seedLoads(order.id);

    const res = await request(app).get(`${TRACK}/${encodeURIComponent(order.orderNumber)}`);
    const t = res.body.data.tracked;
    assert.equal(t.stage, "loading");
    assert.equal(t.trucks.length, 2, "both trucks are shown");
    assert.deepEqual(
      t.trucks.map((x) => [x.index, x.plate, x.status]),
      [
        [1, "LAG-T1", "completed"],
        [2, "LAG-T2", "generated"],
      ],
      "in index order, plate + status each",
    );
    assert.ok(t.trucks[0].statusLabel, "a human label accompanies the status");
    assert.match(t.note, /1 of 2 trucks loaded/, "the note summarises progress");

    const blob = JSON.stringify(t);
    assert.ok(!/Ada Private|Uche Private|\+23480100000/.test(blob), "no driver name or phone leaks");
  });

  test("before release there are no trucks", async () => {
    const { accessToken } = await activeCustomer("6");
    const order = await place(accessToken);
    const res = await request(app).get(`${TRACK}/${encodeURIComponent(order.orderNumber)}`);
    assert.deepEqual(res.body.data.tracked.trucks, [], "empty until assigned at release");
  });

  test("a cancelled order is publicly trackable, shown as cancelled", async () => {
    const { accessToken } = await activeCustomer("4");
    const order = await place(accessToken);
    // Django expresses cancellation as status='canceled' alone — there is no
    // cancelled_at column on consumer_order at all.
    await db.update(consumerOrder).set({ status: "canceled" }).where(eq(consumerOrder.id, order.id));

    const res = await request(app).get(`${TRACK}/${encodeURIComponent(order.orderNumber)}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const tracked = res.body.data.tracked;
    assert.equal(tracked.stage, "cancelled");
    assert.match(tracked.note, /cancelled/i);
    assert.ok(tracked.reached.cancelled, "the cancellation is timestamped");
    assert.deepEqual(tracked.trucks, [], "no trucks on a cancelled order");
  });
});
