// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { db } = require("../config/db");
const { depots, products, depotProductPrices, pfis } = require("../db/schema");
const {
  customerRepo,
  orderRepo,
  orderTruckRepo,
  ticketRepo,
  auditLogRepo,
} = require("../repositories");
const { staffTokenWithRoles, NATIVE_TRANSPORT, closeDb } = require("./helpers");

const PORTAL = "/api/customer/auth";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();

/**
 * THE WHOLE ORDER JOURNEY, end to end, through the real HTTP surface.
 *
 * A customer registers and proves their phone; the desk creates a wallet-funded
 * order (which the payment path advances to Paid); the release desk allocates
 * the fleet trucks; entrance security gates each truck in (opening Loading);
 * ticketing loads each and issues its ticket; exit security gates each out, and
 * the last one out completes the order. Every actor is a different role — this
 * is the composition test: each step's output feeds the next, and the audit
 * trail must read Paid → Released → Loading → Completed at the end.
 *
 * Only two things are stubbed, and only to keep the test about the lifecycle:
 * the customer's virtual account + wallet balance are seeded directly (standing
 * in for a funded Paystack wallet), so order creation pays from the wallet
 * without reaching the external payment provider.
 */
describe("integration — customer register → order → release → gates → completed", () => {
  let depotId;
  let productId;
  let customerId;

  // The people at each post.
  let desk; // super_admin — the walk-in desk that creates the order
  let release; // release desk
  let entry; // entrance-gate security
  let ticketing; // ticketing
  let exit; // exit-gate security

  // A valid NG mobile (813 prefix) with a per-run unique tail.
  const PHONE = `+234813${String(RUN).slice(-7)}`;
  const UNIT_PRICE = 100;
  const ORDER_QTY = 60000; // two 30,000 L trucks
  const TOTAL = UNIT_PRICE * ORDER_QTY;

  before(async () => {
    // Depot + product + configured price + a stocked, active PFI.
    const [depot] = await db
      .insert(depots)
      .values({
        name: "Journey Depot",
        code: `JRN${String(RUN).slice(-5)}`,
        address: "1 Depot Rd",
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
      .values({ name: "Journey PMS", sku: `JRN-PMS-${String(RUN).slice(-5)}`, category: "PMS" })
      .returning();
    productId = product.id;

    await db.insert(depotProductPrices).values({
      depotId,
      productId,
      currentPrice: String(UNIT_PRICE),
    });

    await db.insert(pfis).values({
      pfiNumber: `PFI-JRN-${RUN}`,
      status: "active",
      locationId: depotId,
      productId,
      startingQtyLitres: 500000,
      soldQtyLitres: 0,
    });

    desk = await staffTokenWithRoles(["super_admin"], "test-jrny-desk@soroman.test");
    release = await staffTokenWithRoles(["release"], "test-jrny-release@soroman.test");
    entry = await staffTokenWithRoles(["security_entry"], "test-jrny-entry@soroman.test");
    ticketing = await staffTokenWithRoles(["ticketing"], "test-jrny-ticketing@soroman.test");
    exit = await staffTokenWithRoles(["security_exit"], "test-jrny-exit@soroman.test");
  });

  after(async () => {
    await closeDb();
  });

  test("the full lifecycle, every post played by its own role", async () => {
    // ── 1. Customer self-registers and proves their phone ────────────────────
    const registered = await request(app)
      .post(`${PORTAL}/register`)
      .send({ name: "Journey Customer", phone: PHONE });
    assert.equal(registered.status, 200, JSON.stringify(registered.body));

    const verified = await request(app)
      .post(`${PORTAL}/verify-otp`)
      .set(NATIVE_TRANSPORT)
      .send({ phone: PHONE, code: DEV_CODE });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    assert.ok(verified.body.data.accessToken, "customer got a session on first correct OTP");

    const customer = await customerRepo.findByPhone(PHONE);
    customerId = customer.id;
    assert.equal(customer.status, "Active", "first correct OTP proved the number");

    // Seed a funded wallet + virtual account (stands in for a funded Paystack
    // wallet) so order creation pays from the wallet, no external call.
    await customerRepo.update(customerId, {
      virtualAccountNumber: "1234567890",
      virtualAccountBank: "Test Bank",
      virtualAccountName: "SOROMANNIGERI/ JC",
    });
    await customerRepo.creditBalance(customerId, TOTAL);

    // ── 2. The desk creates the order (wallet pays → Paid) ───────────────────
    const placed = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${desk.accessToken}`)
      .send({
        customer: customerId,
        depot: depotId,
        product: productId,
        state: "Lagos",
        quantity: ORDER_QTY,
        deliveryType: "delivery",
      });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const orderId = placed.body.data.order.id;

    let order = await orderRepo.findById(orderId);
    assert.equal(order.paymentStatus, "Paid", "wallet covered it");
    assert.equal(order.status, "Paid", "payment advanced the lifecycle to Paid");
    assert.ok(order.paymentConfirmedAt, "paymentConfirmedAt stamped");
    // The wallet was fully spent.
    assert.equal(Number((await customerRepo.findById(customerId)).balance), 0);

    // ── 3. Release desk allocates the fleet trucks ───────────────────────────
    const released = await request(app)
      .post(`/api/orders/${orderId}/release`)
      .set("Authorization", `Bearer ${release.accessToken}`)
      .send({
        trucks: [
          { truckNumber: "JRN-T1", quantity: 30000, driverName: "Musa", driverPhone: "+2348010000001" },
          { truckNumber: "JRN-T2", quantity: 30000, driverName: "Ben", driverPhone: "+2348010000002" },
        ],
      });
    assert.equal(released.status, 200, JSON.stringify(released.body));
    assert.equal(released.body.data.order.status, "Released");

    const loads = await orderTruckRepo.findByOrder(orderId);
    assert.equal(loads.length, 2, "two loads allocated");
    const [t1, t2] = loads;

    // ── 4. Entrance security gates each truck in (first opens Loading) ────────
    let res = await request(app)
      .post(`/api/orders/${orderId}/gate-in`)
      .set("Authorization", `Bearer ${entry.accessToken}`)
      .send({ loadId: t1.id });
    assert.equal(res.status, 200);
    assert.equal((await orderRepo.findById(orderId)).status, "Loading", "first truck opened Loading");

    res = await request(app)
      .post(`/api/orders/${orderId}/gate-in`)
      .set("Authorization", `Bearer ${entry.accessToken}`)
      .send({ loadId: t2.id });
    assert.equal(res.status, 200);

    // ── 5. Ticketing loads each and issues its ticket ────────────────────────
    for (const t of [t1, t2]) {
      res = await request(app)
        .post(`/api/orders/${orderId}/trucks/${t.id}/load`)
        .set("Authorization", `Bearer ${ticketing.accessToken}`)
        .send({});
      assert.equal(res.status, 200);
      assert.equal(res.body.data.truck.status, "loaded");
      const ticket = await ticketRepo.findByOrderTruck(t.id);
      assert.ok(ticket, `truck ${t.truckIndex} has a ticket`);
      assert.ok(ticket.ticketNumber.endsWith(`-${t.truckIndex}`), "per-truck ticket number");
    }

    // ── 6. Exit security gates each out; the last completes the order ────────
    res = await request(app)
      .post(`/api/orders/${orderId}/trucks/${t1.id}/gate-out`)
      .set("Authorization", `Bearer ${exit.accessToken}`)
      .send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.data.orderCompleted, false, "one truck still inside");
    assert.equal((await orderRepo.findById(orderId)).status, "Loading");

    res = await request(app)
      .post(`/api/orders/${orderId}/trucks/${t2.id}/gate-out`)
      .set("Authorization", `Bearer ${exit.accessToken}`)
      .send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.data.orderCompleted, true, "last truck out completed the order");

    // ── 7. Final state + the audit trail tells the whole story ───────────────
    order = await orderRepo.findById(orderId);
    assert.equal(order.status, "Completed");
    assert.ok(order.completedAt, "completedAt stamped");

    const finalLoads = await orderTruckRepo.findByOrder(orderId);
    assert.ok(finalLoads.every((l) => l.status === "gated_out"), "every truck has left");

    const timeline = await auditLogRepo.findStateTimeline("order", orderId);
    assert.deepEqual(
      timeline.map((e) => e.newState),
      ["Paid", "Released", "Loading", "Completed"],
      "the audit trail is the full pipeline, in order"
    );
    // The Paid step was the system (payment); the rest were staff at their posts.
    const paidEvent = timeline.find((e) => e.newState === "Paid");
    assert.equal(paidEvent.actorType, "system");
    const releasedEvent = timeline.find((e) => e.newState === "Released");
    assert.equal(releasedEvent.actorType, "staff");
    assert.equal(releasedEvent.actorStaffId, release.staff.id);
  });

  test("the same journey, but the CUSTOMER places their own order", async () => {
    // Identical to the first journey in every downstream step — the only
    // difference is the door the order comes through: the customer places it
    // themselves at the portal, not the desk. Everything after must behave the
    // same, proving the two order-entry paths converge on one lifecycle.
    const phone = `+234813${String(RUN).slice(-6)}9`;

    // ── 1. Customer registers, proves the phone, funds the wallet ────────────
    const registered = await request(app)
      .post(`${PORTAL}/register`)
      .send({ name: "Self Serve", phone });
    assert.equal(registered.status, 200, JSON.stringify(registered.body));

    const verified = await request(app)
      .post(`${PORTAL}/verify-otp`)
      .set(NATIVE_TRANSPORT)
      .send({ phone, code: DEV_CODE });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    const customerToken = verified.body.data.accessToken;

    const cust = await customerRepo.findByPhone(phone);
    await customerRepo.update(cust.id, {
      virtualAccountNumber: "1234500009",
      virtualAccountBank: "Test Bank",
      virtualAccountName: "SOROMANNIGERI/ SS",
    });
    await customerRepo.creditBalance(cust.id, TOTAL);

    // ── 2. The customer places their OWN order (wallet pays → Paid) ──────────
    const placed = await request(app)
      .post("/api/customer/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        depot: depotId,
        product: productId,
        state: "Lagos",
        quantity: ORDER_QTY,
        deliveryType: "delivery",
      });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const orderId = placed.body.data.order.id;
    assert.equal(placed.body.data.order.customerId, cust.id, "the order is the customer's own");
    assert.equal(placed.body.data.order.status, "Paid", "wallet payment advanced it to Paid");

    // ── 3. Release desk allocates the fleet trucks ──────────────────────────
    const released = await request(app)
      .post(`/api/orders/${orderId}/release`)
      .set("Authorization", `Bearer ${release.accessToken}`)
      .send({
        trucks: [
          { truckNumber: "SS-T1", quantity: 30000, driverName: "Ada", driverPhone: "+2348010000003" },
          { truckNumber: "SS-T2", quantity: 30000, driverName: "Uche", driverPhone: "+2348010000004" },
        ],
      });
    assert.equal(released.status, 200, JSON.stringify(released.body));
    const [t1, t2] = await orderTruckRepo.findByOrder(orderId);

    // ── 4. Gate each in (first opens Loading), load each, gate each out ─────
    for (const t of [t1, t2]) {
      const gin = await request(app)
        .post(`/api/orders/${orderId}/gate-in`)
        .set("Authorization", `Bearer ${entry.accessToken}`)
        .send({ loadId: t.id });
      assert.equal(gin.status, 200, JSON.stringify(gin.body));
    }
    assert.equal((await orderRepo.findById(orderId)).status, "Loading");

    for (const t of [t1, t2]) {
      const load = await request(app)
        .post(`/api/orders/${orderId}/trucks/${t.id}/load`)
        .set("Authorization", `Bearer ${ticketing.accessToken}`)
        .send({});
      assert.equal(load.status, 200);
      assert.ok(await ticketRepo.findByOrderTruck(t.id), "each truck ticketed");
    }

    const out1 = await request(app)
      .post(`/api/orders/${orderId}/trucks/${t1.id}/gate-out`)
      .set("Authorization", `Bearer ${exit.accessToken}`)
      .send({});
    assert.equal(out1.body.data.orderCompleted, false);

    const out2 = await request(app)
      .post(`/api/orders/${orderId}/trucks/${t2.id}/gate-out`)
      .set("Authorization", `Bearer ${exit.accessToken}`)
      .send({});
    assert.equal(out2.body.data.orderCompleted, true, "last truck out completed it");

    // ── 5. Same destination as the desk-placed order ────────────────────────
    assert.equal((await orderRepo.findById(orderId)).status, "Completed");
    const timeline = await auditLogRepo.findStateTimeline("order", orderId);
    assert.deepEqual(
      timeline.map((e) => e.newState),
      ["Paid", "Released", "Loading", "Completed"],
      "a customer-placed order reaches the same pipeline end"
    );
  });
});
