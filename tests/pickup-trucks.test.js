// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { customerRepo, orderTruckRepo, ticketRepo, auditLogRepo } = require("../repositories");
const orderService = require("../services/order.service");
const { staffTokenWithRoles, NATIVE_TRANSPORT, closeDb } = require("./helpers");
const { seedState, seedProduct, seedPrice, seedDepot, seedPfi } = require("./liveFixtures");

/**
 * Pay an order from the customer's wallet — the manual "Pay Now" action that
 * moves Pending → Paid. Post-cutover, payment IS the release
 * (orderStatus.releaseOnPayment): a paid order lands already Released.
 */
const payFromWallet = (orderId) =>
  orderService.payOrder({ orderId, actor: { type: "system" } });

const PORTAL_AUTH = "/api/customer/auth";
const ORDERS = "/api/customer/orders";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();
const UNIT_PRICE = 100;

async function activeFundedCustomer(tag, litres) {
  const phone = `+234815${String(RUN).slice(-6)}${tag}`;
  const reg = await request(app).post(`${PORTAL_AUTH}/register`).send({ name: `Pickup ${tag}`, phone });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const ver = await request(app)
    .post(`${PORTAL_AUTH}/verify-otp`)
    .set(NATIVE_TRANSPORT)
    .send({ phone, code: DEV_CODE });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  const customer = await customerRepo.findByPhone(phone);
  // No DVA seeding — wallet funding is manual-deposit-only now, recorded as a
  // credit-ledger entry (consumer_customer stores no balance column at all).
  await customerRepo.recordCreditEntry(customer.id, UNIT_PRICE * litres, {
    description: `test wallet deposit (${tag})`,
  });
  return { customer, accessToken: ver.body.data.accessToken };
}

describe("pickup trucks — declared at order, editable at the gate and at ticketing", () => {
  let depotId;
  let productId;
  let stateName;
  let release;
  let entry;
  let ticketing;

  before(async () => {
    // Live model: pricing/stock are STATE-scoped; the depot joins via
    // location === state name; sellable stock is the state's active PFI.
    const state = await seedState({ name: `Pickup State ${RUN}` });
    stateName = state.name;

    // placeOrder pays into the depot's own bank account (manual deposit
    // only — no Paystack DVA), so every order-placing test depot needs one.
    const depot = await seedDepot({ name: `Pickup Depot ${RUN}`, location: state.name, bankAccount: true });
    depotId = depot.id;

    const product = await seedProduct({ name: `Pickup PMS ${RUN}` });
    productId = product.id;

    await seedPrice(productId, state.id, { price: String(UNIT_PRICE) });
    await seedPfi({ productId, locationId: state.id, startingQtyLitres: "2000000.00" });

    release = await staffTokenWithRoles(["release"], "test-pck-release@soroman.test");
    entry = await staffTokenWithRoles(["security_entry"], "test-pck-entry@soroman.test");
    ticketing = await staffTokenWithRoles(["ticketing"], "test-pck-ticketing@soroman.test");
  });

  after(async () => {
    await closeDb();
  });

  const body = (extra) => ({
    depot: depotId,
    product: productId,
    state: stateName,
    quantity: extra.quantity,
    deliveryType: "pickup",
    companyName: "Pickup Co",
    ...extra,
  });

  test("a customer splits a >60k pickup across trucks, setting each truck's quantity", async () => {
    const { customer, accessToken } = await activeFundedCustomer("1", 100000);

    const res = await request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(
        body({
          quantity: 100000,
          trucks: [
            { truckNumber: "PK-AAA", quantity: 60000 },
            { truckNumber: "PK-BBB", quantity: 40000 },
          ],
        })
      );

    assert.equal(res.status, 201, JSON.stringify(res.body));
    const orderId = res.body.data.order.id;

    // Live rows (consumer_truckallocation): the plate is `plateNumber`,
    // `truckNumber` is the ordinal, and the allocation's own lifecycle lives
    // in `ticketStatus` (pending until ticketing).
    const loads = await orderTruckRepo.findByOrder(orderId);
    assert.equal(loads.length, 2, "one load per declared truck");
    assert.deepEqual(
      loads.map((l) => [l.plateNumber, Number(l.quantity), l.ticketStatus]),
      [
        ["PK-AAA", 60000, "pending"],
        ["PK-BBB", 40000, "pending"],
      ],
      "plate + per-truck quantity captured, awaiting ticketing"
    );
    assert.deepEqual(loads.map((l) => l.truckNumber), [1, 2], "ordinals assigned in declaration order");
    assert.equal(loads[0].orderId, orderId);

    // Placement no longer debits the wallet; paying the order does (a hold
    // against the credit ledger — balance is computed, never stored).
    await payFromWallet(orderId);
    assert.equal(await customerRepo.getBalance(customer.id), 0, "wallet paid the order");
  });

  test("the truck quantities must sum to the order quantity", async () => {
    const { accessToken } = await activeFundedCustomer("2", 100000);
    const res = await request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(
        body({
          quantity: 100000,
          trucks: [
            { truckNumber: "PK-1", quantity: 60000 },
            { truckNumber: "PK-2", quantity: 30000 }, // 90k ≠ 100k
          ],
        })
      );
    assert.equal(res.status, 400);
    assert.match(res.body.message, /sum to the order quantity/i);
  });

  test("no single truck may exceed 60,000 L", async () => {
    const { accessToken } = await activeFundedCustomer("3", 70000);
    const res = await request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body({ quantity: 70000, trucks: [{ truckNumber: "PK-BIG", quantity: 70000 }] }));
    assert.equal(res.status, 400);
    assert.match(res.body.message, /60,000|60000/);
  });

  test("a pickup over 60,000 L can be placed without declaring trucks", async () => {
    const { accessToken } = await activeFundedCustomer("4", 90000);
    const res = await request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body({ quantity: 90000 })); // no trucks — gate captures them later
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const loads = await orderTruckRepo.findByOrder(res.body.data.order.id);
    assert.equal(loads.length, 0, "no loads until declared or gated in");
  });

  // KNOWN CUTOVER REGRESSION (expected failure): the gate flow (gate-in /
  // load / gate-out) has NOT been migrated to the live schema — see the
  // FLAGGED block in controllers/administration/order.controller.js:25-60.
  // gateInTruck reads a `status` column consumer_truckallocation does not
  // have, so every gate-in of an existing load early-returns as
  // "alreadyEntered" without recording anything, and the plate-correction
  // audit never happens. Left failing deliberately.
  test("security correcting the plate at gate-in is recorded as a correction", async () => {
    const { accessToken } = await activeFundedCustomer("5", 30000);
    const placed = await request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body({ quantity: 30000, trucks: [{ truckNumber: "PK-DECLARED", quantity: 30000 }] }));
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const orderId = placed.body.data.order.id;

    await payFromWallet(orderId); // payment IS the release now
    const [load] = await orderTruckRepo.findByOrder(orderId);
    const res = await request(app)
      .post(`/api/orders/${orderId}/gate-in`)
      .set("Authorization", `Bearer ${entry.accessToken}`)
      .send({ loadId: load.id, truckNumber: "PK-ACTUAL" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(
      res.body.data.truck.plateNumber ?? res.body.data.truck.truckNumber,
      "PK-ACTUAL",
      "the arriving plate replaced the declared one"
    );

    const events = await auditLogRepo.findByEntity("order_truck", load.id);
    const corrected = events.find((e) => e.action === "order_truck.plate_corrected");
    assert.ok(corrected, "the plate correction was audited");
    assert.equal(corrected.metadata.from, "PK-DECLARED");
    assert.equal(corrected.metadata.to, "PK-ACTUAL");
  });

  // KNOWN CUTOVER REGRESSION (expected failure): same un-migrated gate flow
  // as above — markTruckLoaded writes plate strings into the live integer
  // `truck_number` ordinal and reads a nonexistent `status` column, so the
  // gantry swap can neither persist nor audit. Left failing deliberately.
  test("a truck swapped at the gantry is recorded and the ticket names the new truck", async () => {
    const { accessToken } = await activeFundedCustomer("6", 30000);
    const placed = await request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body({ quantity: 30000, trucks: [{ truckNumber: "PK-FIRST", quantity: 30000 }] }));
    const orderId = placed.body.data.order.id;

    await payFromWallet(orderId); // payment IS the release now
    const [load] = await orderTruckRepo.findByOrder(orderId);
    await request(app)
      .post(`/api/orders/${orderId}/gate-in`)
      .set("Authorization", `Bearer ${entry.accessToken}`)
      .send({ loadId: load.id }); // arrives as declared

    // At the gantry the first truck failed; a different one loads.
    const res = await request(app)
      .post(`/api/orders/${orderId}/trucks/${load.id}/load`)
      .set("Authorization", `Bearer ${ticketing.accessToken}`)
      .send({ truckNumber: "PK-SECOND" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(
      res.body.data.truck.plateNumber ?? res.body.data.truck.truckNumber,
      "PK-SECOND",
      "the actual loaded truck"
    );

    const events = await auditLogRepo.findByEntity("order_truck", load.id);
    const swapped = events.find((e) => e.action === "order_truck.truck_swapped");
    assert.ok(swapped, "the swap was audited");
    assert.equal(swapped.metadata.from, "PK-FIRST");
    assert.equal(swapped.metadata.to, "PK-SECOND");

    // Live tickets (consumer_truckticket) key on (orderId, truckNumber) —
    // there is no orderTruckId column linking a ticket to an allocation row.
    const ticket = await ticketRepo.findByOrderAndTruckNumber(orderId, load.truckNumber);
    assert.ok(ticket, "a ticket was issued");
    // The plate lives on the load (single source of truth); the load now
    // carries the swapped-in truck.
    const reloaded = await orderTruckRepo.findById(load.id);
    assert.equal(reloaded.plateNumber, "PK-SECOND", "the load the ticket points at is the truck that loaded");
  });

  test("a customer can fill in a plate on a pending pickup declaration via the portal", async () => {
    const { accessToken } = await activeFundedCustomer("8", 30000);
    const placed = await request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body({ quantity: 30000, trucks: [{ quantity: 30000 }] }));
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const ref = placed.body.data.order.orderNumber;

    const before = await orderTruckRepo.findByOrder(placed.body.data.order.id);
    assert.equal(before.length, 1);
    assert.equal(before[0].plateNumber, null, "plate was left blank at order");

    const res = await request(app)
      .patch(`${ORDERS}/by-ref/${encodeURIComponent(ref)}/trucks`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        trucks: [{ truckNumber: "PK-LATER", quantity: 30000, driverName: "Musa" }],
      });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.order.trucks[0].plate, "PK-LATER");
    assert.equal(res.body.data.order.trucks[0].driverName, "Musa");
    assert.equal(res.body.data.order.trucks[0].status, "pending");

    const after = await orderTruckRepo.findByOrder(placed.body.data.order.id);
    assert.equal(after.length, 1);
    assert.equal(after[0].plateNumber, "PK-LATER");
    assert.equal(after[0].driverName, "Musa");
  });

  test("a customer can declare trucks later when they skipped them at order (≤60k)", async () => {
    const { accessToken } = await activeFundedCustomer("9", 30000);
    const placed = await request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body({ quantity: 30000 }));
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    assert.equal((await orderTruckRepo.findByOrder(placed.body.data.order.id)).length, 0);

    const ref = placed.body.data.order.orderNumber;
    const res = await request(app)
      .patch(`${ORDERS}/by-ref/${encodeURIComponent(ref)}/trucks`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ trucks: [{ truckNumber: "PK-NEW", quantity: 30000 }] });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.order.trucks.length, 1);
    assert.equal(res.body.data.order.trucks[0].plate, "PK-NEW");
  });

  test("customer truck update is refused once a load has been ticketed", async () => {
    const { accessToken } = await activeFundedCustomer("0", 30000);
    const placed = await request(app)
      .post(ORDERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body({ quantity: 30000, trucks: [{ truckNumber: "PK-GATE", quantity: 30000 }] }));
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const orderId = placed.body.data.order.id;
    const ref = placed.body.data.order.orderNumber;
    const load = (await orderTruckRepo.findByOrder(orderId))[0];

    await payFromWallet(orderId);

    // The live lock keys on the allocation's ticketStatus: once past
    // "pending" the declaration is no longer the customer's to rewrite
    // (services/order.service.js updatePickupTrucks). Progressed directly
    // here because the gate-in endpoint itself is still un-migrated (see the
    // FLAGGED block in controllers/administration/order.controller.js) —
    // when that pass lands, this can go back through the real gate.
    await orderTruckRepo.update(load.id, { ticketStatus: "generated" });

    const res = await request(app)
      .patch(`${ORDERS}/by-ref/${encodeURIComponent(ref)}/trucks`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ trucks: [{ truckNumber: "PK-TOO-LATE", quantity: 30000 }] });
    assert.equal(res.status, 409, JSON.stringify(res.body));
  });
});
