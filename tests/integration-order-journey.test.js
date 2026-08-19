// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const {
  customerRepo,
  orderRepo,
  orderTruckRepo,
  ticketRepo,
  auditLogRepo,
  staffRepo,
} = require("../repositories");
const { staffTokenWithRoles, NATIVE_TRANSPORT, closeDb } = require("./helpers");
const { seedState, seedProduct, seedPrice, seedDepot, seedPfi } = require("./liveFixtures");

const PORTAL = "/api/customer/auth";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();

/**
 * THE WHOLE ORDER JOURNEY, end to end, through the real HTTP surface.
 *
 * A customer registers and proves their phone; the desk creates a wallet-funded
 * order (which the payment path advances to Paid AND Released — post-cutover,
 * payment IS the release); the release desk allocates the fleet trucks;
 * entrance security gates each truck in (opening Loading); ticketing loads each
 * and issues its ticket; exit security gates each out, and the last one out
 * completes the order. Every actor is a different role — this is the
 * composition test: each step's output feeds the next, and the audit trail must
 * read Paid → Released → Loading → Completed at the end.
 *
 * Only the customer's wallet balance is stubbed (a credit-ledger entry standing
 * in for a recorded manual deposit — consumer_customer stores no balance, and
 * Paystack DVAs are disabled), so order payment settles from the wallet without
 * reaching any external payment provider.
 *
 * KNOWN CUTOVER REGRESSION (both journey tests fail at step 3): the truck
 * allocation + gate flow has NOT been migrated to the live schema — see the
 * FLAGGED block in controllers/administration/order.controller.js:25-60.
 * Everything through payment (steps 1-2) is live-migrated and passes; the
 * release-desk truck allocation 500s (dead columns, missing NOT NULLs, and a
 * Date written into the mode:'string' released_at column), so the journeys
 * cannot proceed to the gates. Left failing deliberately until the gate/
 * ticketing rework lands.
 */
describe("integration — customer register → order → release → gates → completed", () => {
  let depotId;
  let productId;
  let stateName;
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
    // Live model: state-scoped pricing + a stocked, active PFI on the state;
    // the depot joins via location === state name and needs a linked bank
    // account (placeOrder pays into the depot's own account — manual deposit
    // only, no Paystack DVA).
    const state = await seedState({ name: `Journey State ${RUN}` });
    stateName = state.name;

    const depot = await seedDepot({ name: `Journey Depot ${RUN}`, location: state.name, bankAccount: true });
    depotId = depot.id;

    const product = await seedProduct({ name: `Journey PMS ${RUN}` });
    productId = product.id;

    await seedPrice(productId, state.id, { price: String(UNIT_PRICE) });
    await seedPfi({ productId, locationId: state.id, startingQtyLitres: "500000.00" });

    desk = await staffTokenWithRoles(["super_admin"], "test-jrny-desk@soroman.test");
    // Desk order creation is location-scoped (isWithinScope on depotIds);
    // staffRepo.create defaults canViewAllLocations to false, so the desk
    // needs the full-view flag — scope is a flag, not a role, on this model.
    await staffRepo.update(desk.staff.id, { canViewAllLocations: true });
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
    // consumer_customer has no status column — the session itself is the live
    // proof the first correct OTP verified the number.
    assert.ok(verified.body.data.accessToken, "customer got a session on first correct OTP");

    const customer = await customerRepo.findByPhone(PHONE);
    customerId = customer.id;

    // Fund the wallet: a credit-ledger entry standing in for a recorded
    // manual deposit (balance is computed from sman.customer_credits).
    await customerRepo.recordCreditEntry(customerId, TOTAL, { description: "journey test deposit" });

    // ── 2. The desk creates the order (Unpaid), then finance pays it ─────────
    const placed = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${desk.accessToken}`)
      .send({
        customer: customerId,
        depot: depotId,
        product: productId,
        state: stateName,
        quantity: ORDER_QTY,
        deliveryType: "delivery",
        companyName: "Journey Co",
      });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const orderId = placed.body.data.order.id;

    let order = await orderRepo.findById(orderId);
    assert.equal(order.paymentStatus, "Unpaid", "created Unpaid, awaiting payment");

    // The manual "Pay Now" action — finance settles it from the wallet.
    const paid = await request(app)
      .post(`/api/orders/${orderId}/pay`)
      .set("Authorization", `Bearer ${desk.accessToken}`)
      .send({});
    assert.equal(paid.status, 200, JSON.stringify(paid.body));

    order = await orderRepo.findById(orderId);
    assert.equal(order.paymentStatus, "Paid", "wallet covered it");
    assert.equal(order.status, "Released", "payment released it in the same transaction");
    assert.ok(order.paymentConfirmedAt, "paymentConfirmedAt stamped");
    assert.ok(order.releasedAt, "releasedAt stamped");
    // The wallet was fully spent (the payment hold consumes the balance).
    assert.equal(await customerRepo.getBalance(customerId), 0);

    // ── 3. Release desk allocates the fleet trucks ───────────────────────────
    // The order is already Released; this call is here for the allocation, and
    // the transition it used to drive is a no-op.
    // >>> FAILS HERE — un-migrated truck allocation (see the describe comment).
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

    // ── 5. Ticketing confirms each loading and issues its ticket ─────────────
    for (const t of [t1, t2]) {
      res = await request(app)
        .post(`/api/orders/${orderId}/trucks/${t.id}/load`)
        .set("Authorization", `Bearer ${ticketing.accessToken}`)
        .send({});
      assert.equal(res.status, 200);
      assert.ok(res.body.data.truck, "the load came back");
      // Live tickets (consumer_truckticket) key on (orderId, truckNumber) —
      // there is no orderTruckId/ticketNumber column on the live table.
      const ticket = await ticketRepo.findByOrderAndTruckNumber(orderId, t.truckNumber);
      assert.ok(ticket, `truck ${t.truckNumber} has a ticket`);
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

    const timeline = await auditLogRepo.findStateTimeline("order", orderId);
    assert.deepEqual(
      timeline.map((e) => e.newState),
      ["Paid", "Released", "Loading", "Completed"],
      "the audit trail is the full pipeline, in order"
    );
    // The Paid step is a staff action (finance's manual "Pay Now"); the rest
    // were staff at their posts. Release rides on the payment, so it is
    // attributed to whoever took the money — not to the release desk, whose
    // call arrived afterwards and found the work already done.
    const paidEvent = timeline.find((e) => e.newState === "Paid");
    assert.equal(paidEvent.actorType, "staff");
    assert.equal(paidEvent.actorStaffId, desk.staff.id);
    const releasedEvent = timeline.find((e) => e.newState === "Released");
    assert.equal(releasedEvent.actorType, "staff");
    assert.equal(releasedEvent.actorStaffId, desk.staff.id);
    assert.equal(releasedEvent.metadata?.trigger, "payment");

    // The audit trail records every business event, not only state changes:
    // creation is there before any transition, and each truck's physical
    // movements are logged per load.
    const orderEvents = (await auditLogRepo.findByEntity("order", orderId)).map((e) => e.action);
    assert.ok(orderEvents.includes("order.created"), "order.created is recorded");
    assert.equal(orderEvents[0], "order.created", "creation is the first event on the order");

    for (const t of await orderTruckRepo.findByOrder(orderId)) {
      const truckActions = (await auditLogRepo.findByEntity("order_truck", t.id)).map((e) => e.action);
      for (const a of ["order_truck.allocated", "order_truck.gated_in", "order_truck.loaded", "order_truck.gated_out"]) {
        assert.ok(truckActions.includes(a), `${a} logged for load ${t.id}`);
      }
    }
  });

  test("the same journey, but the CUSTOMER places their own order", async () => {
    // Identical to the first journey in every downstream step — the only
    // difference is the door the order comes through: the customer places it
    // themselves at the portal, not the desk. Everything after must behave the
    // same, proving the two order-entry paths converge on one lifecycle.
    // >>> FAILS at the release-desk allocation, same regression as above.
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
    await customerRepo.recordCreditEntry(cust.id, TOTAL, { description: "journey test deposit (self)" });

    // ── 2. The customer places their OWN order (Unpaid), finance pays it ─────
    const placed = await request(app)
      .post("/api/customer/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        depot: depotId,
        product: productId,
        state: stateName,
        quantity: ORDER_QTY,
        deliveryType: "delivery",
        companyName: "Journey Co",
      });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const orderId = placed.body.data.order.id;
    assert.equal(placed.body.data.order.customerId, cust.id, "the order is the customer's own");
    assert.equal(placed.body.data.order.status, "Pending", "created Unpaid, awaiting payment");

    const settled = await request(app)
      .post(`/api/orders/${orderId}/pay`)
      .set("Authorization", `Bearer ${desk.accessToken}`)
      .send({});
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    assert.equal((await orderRepo.findById(orderId)).status, "Released", "payment released it");

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
      assert.ok(await ticketRepo.findByOrderAndTruckNumber(orderId, t.truckNumber), "each truck ticketed");
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

  test("pickup of any amount can be placed without declaring trucks", async () => {
    const phone = `+234813${String(RUN).slice(-6)}7`;

    const registered = await request(app)
      .post(`${PORTAL}/register`)
      .send({ name: "Big Pickup", phone });
    assert.equal(registered.status, 200, JSON.stringify(registered.body));

    const verified = await request(app)
      .post(`${PORTAL}/verify-otp`)
      .set(NATIVE_TRANSPORT)
      .send({ phone, code: DEV_CODE });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));

    const cust = await customerRepo.findByPhone(phone);

    // 120,000 L — well over one tanker — with no trucks declared. Desk and
    // portal may both book it as a single pickup; security splits it across
    // trucks at the gate.
    const placed = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${desk.accessToken}`)
      .send({
        customer: cust.id,
        depot: depotId,
        product: productId,
        state: stateName,
        quantity: 120000,
        deliveryType: "pickup",
        companyName: "Big Pickup Co",
      });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const orderId = placed.body.data.order.id;

    const loads = await orderTruckRepo.findByOrder(orderId);
    assert.equal(loads.length, 0, "no loads declared at order; captured at the gate");

    const portal = await request(app)
      .post("/api/customer/orders")
      .set("Authorization", `Bearer ${verified.body.data.accessToken}`)
      .send({
        depot: depotId,
        product: productId,
        state: stateName,
        quantity: 90000,
        deliveryType: "pickup",
        companyName: "Big Pickup Co",
      });
    assert.equal(portal.status, 201, JSON.stringify(portal.body));
    assert.equal(
      (await orderTruckRepo.findByOrder(portal.body.data.order.id)).length,
      0,
      "portal pickup also defers trucks to the gate"
    );
  });
});
