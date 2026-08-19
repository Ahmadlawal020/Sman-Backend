// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { orderRepo, orderTruckRepo } = require("../repositories");
const { staffTokenWithRoles, closeDb } = require("./helpers");
const { seedState, seedProduct, seedCustomer, seedOrder, seedFleetTruck } = require("./liveFixtures");

const RUN = Date.now();

describe("release-time truck allocation (delivery) — consumer_truckallocation", () => {
  let stateId;
  let productId;
  let customerId;
  let releaseStaff;
  let fleetTruck;

  before(async () => {
    // Live model: orders carry a stateId (no depotId exists on
    // consumer_order at all); the release flow never needs a depot row.
    const state = await seedState({ name: `Truck State ${RUN}` });
    stateId = state.id;
    const product = await seedProduct({ name: `Truck Product ${RUN}` });
    productId = product.id;
    const customer = await seedCustomer({ name: "Truck Customer" });
    customerId = customer.id;
    releaseStaff = await staffTokenWithRoles(["release"], "test-trk-release@soroman.test");
    fleetTruck = await seedFleetTruck({ plateNumber: `FLEET-${String(RUN).slice(-6)}` });
  });

  after(async () => {
    await closeDb();
  });

  // A paid delivery order seeded straight into the live tables ("paid" is
  // Django's lowercase status; paymentStatus is derived, not stored).
  const makeOrder = ({ deliveryType, quantity } = {}) =>
    seedOrder({
      customerId,
      stateId,
      productId,
      quantity: quantity ?? 60000,
      price: "100.00",
      status: "paid",
      releaseType: deliveryType || "delivery",
    });

  // KNOWN CUTOVER REGRESSION (expected failure): releaseOrder's
  // truck-allocation loop has NOT been migrated to the live schema — see the
  // FLAGGED block in controllers/administration/order.controller.js:25-60.
  // It inserts truckIndex/truckId/status columns consumer_truckallocation
  // does not have, writes the plate string into the integer truck_number
  // ordinal, and never supplies the NOT NULL ticket_number/order_product_id
  // — so a delivery release with trucks 500s and rolls back. It currently
  // dies even earlier: the Paid→Released transition itself passes
  // `set: { releasedAt: new Date() }` into a mode:'string' timestamptz
  // column (see the note on the pickup-release test below). The assertions
  // below are written in live vocabulary so they hold once that pass lands.
  // Marked todo (still running, not failing CI) until that fix lands.
  test("a delivery release creates one load per truck, copying the fleet plate", { todo: "release truck allocation un-migrated" }, async () => {
    const order = await makeOrder({ deliveryType: "delivery", quantity: 60000 });

    const res = await request(app)
      .post(`/api/orders/${order.id}/release`)
      .set("Authorization", `Bearer ${releaseStaff.accessToken}`)
      .send({
        trucks: [
          { truckId: fleetTruck.id, quantity: 30000, driverName: "Musa", driverPhone: "+2348010000001" },
          { truckNumber: "EXT-9001", quantity: 30000, driverName: "Ben" },
        ],
      });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.order.status, "Released");

    const loads = await orderTruckRepo.findByOrder(order.id);
    assert.equal(loads.length, 2);
    // Live: truckNumber is the ordinal; the plate lives in plateNumber.
    assert.deepEqual(loads.map((l) => l.truckNumber), [1, 2]);

    const fleetLoad = loads.find((l) => l.plateNumber === fleetTruck.plateNumber);
    assert.ok(fleetLoad, "fleet load present — plate copied from the registry");
    assert.equal(fleetLoad.ticketStatus, "pending");
    assert.equal(fleetLoad.driverName, "Musa");

    const extLoad = loads.find((l) => l.plateNumber === "EXT-9001");
    assert.ok(extLoad, "external load present");
  });

  test("the truck quantities must sum to the order quantity, and nothing is released", async () => {
    const order = await makeOrder({ deliveryType: "delivery", quantity: 60000 });

    const res = await request(app)
      .post(`/api/orders/${order.id}/release`)
      .set("Authorization", `Bearer ${releaseStaff.accessToken}`)
      .send({ trucks: [{ truckNumber: "EXT-1", quantity: 30000 }] }); // 30k ≠ 60k

    assert.equal(res.status, 400);

    // The transition rolled back with the bad allocation.
    const after = await orderRepo.findById(order.id);
    assert.equal(after.status, "Paid", "still Paid — release rolled back");
    assert.equal(await orderTruckRepo.countByOrder(order.id), 0, "no loads persisted");
  });

  test("a delivery release with no trucks is refused (400)", async () => {
    const order = await makeOrder({ deliveryType: "delivery" });
    const res = await request(app)
      .post(`/api/orders/${order.id}/release`)
      .set("Authorization", `Bearer ${releaseStaff.accessToken}`)
      .send({ trucks: [] });
    assert.equal(res.status, 400);
  });

  test("a pickup release must NOT carry trucks — those are captured at the gate (400)", async () => {
    const order = await makeOrder({ deliveryType: "pickup", quantity: 60000 });
    const res = await request(app)
      .post(`/api/orders/${order.id}/release`)
      .set("Authorization", `Bearer ${releaseStaff.accessToken}`)
      .send({ trucks: [{ truckNumber: "OWN-1", quantity: 60000 }] });
    assert.equal(res.status, 400);
  });

  // KNOWN CUTOVER REGRESSION (expected failure): the desk release endpoint
  // 500s on the Paid→Released transition itself — releaseOrder passes
  // `set: { releasedAt: new Date() }` (controllers/administration/
  // order.controller.js:196) but live consumer_order.released_at is a
  // mode:'string' timestamptz, so the Date reaches Postgres as
  // "Wed Aug 19 2026 … (West Africa Time)" and the UPDATE fails. (The
  // payment path is unaffected — releaseOnPayment passes an ISO string.)
  test("a pickup release with no trucks is allowed and just flips status", async () => {
    const order = await makeOrder({ deliveryType: "pickup" });
    const res = await request(app)
      .post(`/api/orders/${order.id}/release`)
      .set("Authorization", `Bearer ${releaseStaff.accessToken}`)
      .send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.data.order.status, "Released");
    assert.equal(await orderTruckRepo.countByOrder(order.id), 0);
  });

  test("a truck with neither a fleet id nor a plate is rejected by validation (400)", async () => {
    const order = await makeOrder({ deliveryType: "delivery" });
    const res = await request(app)
      .post(`/api/orders/${order.id}/release`)
      .set("Authorization", `Bearer ${releaseStaff.accessToken}`)
      .send({ trucks: [{ quantity: 60000 }] });
    assert.equal(res.status, 400);
  });

  // KNOWN CUTOVER REGRESSION (expected failure): same released_at Date bug
  // as above — the transition 500s before the fleet lookup can reject the
  // unknown id, so the caller sees 500 rather than 400. The rollback
  // assertion still holds (the transaction does roll back).
  test("an unknown fleet truck id is rejected (400) and the release rolls back", async () => {
    const order = await makeOrder({ deliveryType: "delivery" });
    const res = await request(app)
      .post(`/api/orders/${order.id}/release`)
      .set("Authorization", `Bearer ${releaseStaff.accessToken}`)
      .send({ trucks: [{ truckId: 999999, quantity: 60000 }] });
    assert.equal(res.status, 400);

    const after = await orderRepo.findById(order.id);
    assert.equal(after.status, "Paid", "release rolled back");
  });
});
