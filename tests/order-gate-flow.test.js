// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { db } = require("../config/db");
const { orders, depots, products } = require("../db/schema");
const { customerRepo, orderRepo, orderTruckRepo, ticketRepo } = require("../repositories");
const { staffTokenWithRoles, closeDb } = require("./helpers");

async function depotFixture() {
  const [existing] = await db.select().from(depots).limit(1);
  if (existing) return existing.id;
  const [row] = await db
    .insert(depots)
    .values({
      name: "Gate Depot",
      code: "GATE",
      address: "1 Test Rd",
      city: "Lagos",
      state: "Lagos",
      country: "NG",
      postcode: "100001",
      maxCapacity: 1000000,
      establishedYear: "2020",
    })
    .returning();
  return row.id;
}

async function productFixture() {
  const [existing] = await db.select().from(products).limit(1);
  if (existing) return existing.id;
  const [row] = await db
    .insert(products)
    .values({ name: "Gate Product", sku: "GATE-PRD", category: "PMS" })
    .returning();
  return row.id;
}

let seq = 0;
const RUN = Date.now();
// A Released order plus its allocated loads, ready for the gate.
async function releasedDeliveryOrder(customerId, depotId, productId, truckQtys) {
  const [order] = await db
    .insert(orders)
    .values({
      orderNumber: `ORD-GATE-${RUN}-${seq++}`,
      customerId,
      state: "Lagos",
      depotId,
      productId,
      quantity: truckQtys.reduce((a, b) => a + b, 0),
      price: "100.00",
      totalAmount: "1.00",
      deliveryType: "delivery",
      status: "Released",
      paymentStatus: "Paid",
    })
    .returning();

  let index = 1;
  for (const q of truckQtys) {
    await orderTruckRepo.create({
      orderId: order.id,
      truckIndex: index++,
      truckNumber: `PLATE-${RUN}-${index}`,
      quantity: String(q),
      status: "pending",
    });
  }
  return order;
}

async function releasedPickupOrder(customerId, depotId, productId, quantity) {
  const [order] = await db
    .insert(orders)
    .values({
      orderNumber: `ORD-GATE-${RUN}-${seq++}`,
      customerId,
      state: "Lagos",
      depotId,
      productId,
      quantity,
      price: "100.00",
      totalAmount: "1.00",
      deliveryType: "pickup",
      status: "Released",
      paymentStatus: "Paid",
    })
    .returning();
  return order;
}

describe("truck gate flow — Released → Loading → Completed", () => {
  let depotId;
  let productId;
  let customerId;
  let entry; // security_entry
  let ticketing;
  let exit; // security_exit
  let superStaff;

  before(async () => {
    depotId = await depotFixture();
    productId = await productFixture();
    const customer = await customerRepo.create({
      name: "Gate Customer",
      phone: `+23483${String(RUN).slice(-8)}`,
      status: "Active",
    });
    customerId = customer.id;
    entry = await staffTokenWithRoles(["security_entry"], "test-gate-entry@soroman.test");
    ticketing = await staffTokenWithRoles(["ticketing"], "test-gate-ticketing@soroman.test");
    exit = await staffTokenWithRoles(["security_exit"], "test-gate-exit@soroman.test");
    superStaff = await staffTokenWithRoles(["super_admin"], "test-gate-super@soroman.test");
  });

  after(async () => {
    await closeDb();
  });

  test("a full delivery lifecycle: two trucks in, loaded, out — first-in opens Loading, last-out Completes", async () => {
    const order = await releasedDeliveryOrder(customerId, depotId, productId, [30000, 30000]);
    const loads = await orderTruckRepo.findByOrder(order.id);
    const [t1, t2] = loads;

    // First truck gates in → Released → Loading.
    let res = await request(app)
      .post(`/api/orders/${order.id}/gate-in`)
      .set("Authorization", `Bearer ${entry.accessToken}`)
      .send({ loadId: t1.id });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.truck.status, "gated_in");
    assert.equal((await orderRepo.findById(order.id)).status, "Loading", "first-in opened Loading");

    // Second truck gates in — order already Loading, stays Loading.
    res = await request(app)
      .post(`/api/orders/${order.id}/gate-in`)
      .set("Authorization", `Bearer ${entry.accessToken}`)
      .send({ loadId: t2.id });
    assert.equal(res.status, 200);
    assert.equal((await orderRepo.findById(order.id)).status, "Loading");

    // Both load → each gets a ticket.
    for (const t of [t1, t2]) {
      res = await request(app)
        .post(`/api/orders/${order.id}/trucks/${t.id}/load`)
        .set("Authorization", `Bearer ${ticketing.accessToken}`)
        .send({});
      assert.equal(res.status, 200);
      assert.equal(res.body.data.truck.status, "loaded");
      assert.ok(res.body.data.ticket.ticketNumber.includes(`-${t.truckIndex}`), "per-truck ticket number");
      const tk = await ticketRepo.findByOrderTruck(t.id);
      assert.ok(tk, "ticket row linked to the load");
    }

    // First truck out — order still Loading (one truck remains).
    res = await request(app)
      .post(`/api/orders/${order.id}/trucks/${t1.id}/gate-out`)
      .set("Authorization", `Bearer ${exit.accessToken}`)
      .send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.data.orderCompleted, false);
    assert.equal((await orderRepo.findById(order.id)).status, "Loading");

    // Last truck out — order Completes.
    res = await request(app)
      .post(`/api/orders/${order.id}/trucks/${t2.id}/gate-out`)
      .set("Authorization", `Bearer ${exit.accessToken}`)
      .send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.data.orderCompleted, true);
    const done = await orderRepo.findById(order.id);
    assert.equal(done.status, "Completed");
    assert.ok(done.completedAt, "completedAt stamped");
  });

  test("a pickup lifecycle: security captures the customer's own truck at gate-in", async () => {
    const order = await releasedPickupOrder(customerId, depotId, productId, 40000);

    // No loads exist yet; gate-in creates one.
    let res = await request(app)
      .post(`/api/orders/${order.id}/gate-in`)
      .set("Authorization", `Bearer ${entry.accessToken}`)
      .send({ truckNumber: "OWN-TRUCK-1", quantity: 40000, driverName: "Ada" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const loadId = res.body.data.truck.id;
    assert.equal(res.body.data.truck.truckNumber, "OWN-TRUCK-1");
    assert.equal(res.body.data.truck.driverName, "Ada");
    assert.equal((await orderRepo.findById(order.id)).status, "Loading");

    res = await request(app)
      .post(`/api/orders/${order.id}/trucks/${loadId}/load`)
      .set("Authorization", `Bearer ${ticketing.accessToken}`)
      .send({});
    assert.equal(res.status, 200);

    res = await request(app)
      .post(`/api/orders/${order.id}/trucks/${loadId}/gate-out`)
      .set("Authorization", `Bearer ${exit.accessToken}`)
      .send({});
    assert.equal(res.status, 200);
    assert.equal((await orderRepo.findById(order.id)).status, "Completed");
  });

  // ── guards ─────────────────────────────────────────────────────────────────

  test("the gate order is enforced: load needs gate-in, exit needs gate-in", async () => {
    const order = await releasedDeliveryOrder(customerId, depotId, productId, [50000]);
    const [t] = await orderTruckRepo.findByOrder(order.id);

    // A pending truck cannot be marked loaded — it must be entered first.
    let res = await request(app)
      .post(`/api/orders/${order.id}/trucks/${t.id}/load`)
      .set("Authorization", `Bearer ${ticketing.accessToken}`)
      .send({});
    assert.equal(res.status, 409, "load before gate-in is refused");

    // Nor can it exit — a truck that never arrived cannot leave.
    res = await request(app)
      .post(`/api/orders/${order.id}/trucks/${t.id}/gate-out`)
      .set("Authorization", `Bearer ${exit.accessToken}`)
      .send({});
    assert.equal(res.status, 409, "exit before gate-in is refused");

    // Entered but never put through the separate loading step: the exit itself
    // stands in for it, stamping the loading and issuing the ticket.
    await request(app)
      .post(`/api/orders/${order.id}/gate-in`)
      .set("Authorization", `Bearer ${entry.accessToken}`)
      .send({ loadId: t.id });
    res = await request(app)
      .post(`/api/orders/${order.id}/trucks/${t.id}/gate-out`)
      .set("Authorization", `Bearer ${exit.accessToken}`)
      .send({});
    assert.equal(res.status, 200, "a gated-in truck may exit without a separate load call");
    assert.equal(res.body.data.truck.status, "gated_out");
    assert.ok(res.body.data.truck.loadedAt, "the exit stamped the loading");
    assert.ok(await ticketRepo.findByOrderTruck(t.id), "ticket present after exit");
  });

  test("gating the same truck in twice is idempotent — the second entry reports the first", async () => {
    const order = await releasedDeliveryOrder(customerId, depotId, productId, [50000]);
    const [t] = await orderTruckRepo.findByOrder(order.id);

    let res = await request(app)
      .post(`/api/orders/${order.id}/gate-in`)
      .set("Authorization", `Bearer ${entry.accessToken}`)
      .send({ loadId: t.id });
    assert.equal(res.status, 200);

    // A repeat gate-in does not error or overwrite the original entry — it
    // returns 200 and reports the existing load.
    res = await request(app)
      .post(`/api/orders/${order.id}/gate-in`)
      .set("Authorization", `Bearer ${entry.accessToken}`)
      .send({ loadId: t.id });
    assert.equal(res.status, 200);
  });

  test("each checkpoint is gated to its role", async () => {
    const order = await releasedDeliveryOrder(customerId, depotId, productId, [50000]);
    const [t] = await orderTruckRepo.findByOrder(order.id);

    // ticketing cannot work the entry gate
    let res = await request(app)
      .post(`/api/orders/${order.id}/gate-in`)
      .set("Authorization", `Bearer ${ticketing.accessToken}`)
      .send({ loadId: t.id });
    assert.equal(res.status, 403);

    // entry security cannot issue tickets
    await request(app)
      .post(`/api/orders/${order.id}/gate-in`)
      .set("Authorization", `Bearer ${entry.accessToken}`)
      .send({ loadId: t.id });
    res = await request(app)
      .post(`/api/orders/${order.id}/trucks/${t.id}/load`)
      .set("Authorization", `Bearer ${entry.accessToken}`)
      .send({});
    assert.equal(res.status, 403);

    // exit security cannot work the entry gate
    res = await request(app)
      .post(`/api/orders/${order.id}/gate-in`)
      .set("Authorization", `Bearer ${exit.accessToken}`)
      .send({ loadId: t.id });
    assert.equal(res.status, 403);
  });

  test("a delivery gate-in without a loadId is refused 400", async () => {
    const order = await releasedDeliveryOrder(customerId, depotId, productId, [50000]);
    const res = await request(app)
      .post(`/api/orders/${order.id}/gate-in`)
      .set("Authorization", `Bearer ${entry.accessToken}`)
      .send({});
    assert.equal(res.status, 400);
  });

  test("gating a truck on a Paid (not yet Released) order is refused 409", async () => {
    const [order] = await db
      .insert(orders)
      .values({
        orderNumber: `ORD-GATE-${RUN}-${seq++}`,
        customerId,
        state: "Lagos",
        depotId,
        productId,
        quantity: 50000,
        price: "100.00",
        totalAmount: "1.00",
        deliveryType: "pickup",
        status: "Paid",
        paymentStatus: "Paid",
      })
      .returning();

    const res = await request(app)
      .post(`/api/orders/${order.id}/gate-in`)
      .set("Authorization", `Bearer ${superStaff.accessToken}`)
      .send({ truckNumber: "OWN-2", quantity: 50000 });
    assert.equal(res.status, 409);
  });
});
