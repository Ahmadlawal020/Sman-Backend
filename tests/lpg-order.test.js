// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { db } = require("../config/db");
const { lpgStations, lpgStationCylinders } = require("../db/schema");
const { customerRepo, lpgStationRepo, auditLogRepo } = require("../repositories");
const { staffTokenWithRoles, closeDb } = require("./helpers");

const RUN = Date.now();
const LPG = "/api/lpg-order-requests";
const SIZE_KG = 12;
const START_QTY = 50;

describe("LPG order requests — cancel returns reserved cylinders to stock", () => {
  let staff;
  let stationId;
  let customerId;

  before(async () => {
    // super_admin clears every gate on the LPG routes (verifyStaff's admin gate
    // and the orders/finance requireRole gates alike).
    staff = await staffTokenWithRoles(["super_admin"], `lpg-${RUN}@soroman.test`);

    const [station] = await db
      .insert(lpgStations)
      .values({
        name: "LPG Test Station",
        code: `LPG${String(RUN).slice(-6)}`,
        address: "1 Gas Rd",
        city: "Lagos",
        state: "Lagos",
        country: "NG",
        postcode: "100001",
        lpgCapacityKg: 100000,
        pricePerKg: "1200",
        establishedYear: "2020",
      })
      .returning();
    stationId = station.id;

    await db
      .insert(lpgStationCylinders)
      .values({ lpgStationId: stationId, cylinderSizeKg: SIZE_KG, quantity: START_QTY });

    const customer = await customerRepo.create({
      name: "LPG Customer",
      phone: `+234817${String(RUN).slice(-7)}`,
      status: "Active",
    });
    customerId = customer.id;
  });

  after(async () => {
    await closeDb();
  });

  async function placeAndApprove(quantity) {
    const created = await request(app)
      .post(LPG)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({
        customerId,
        lpgStationId: stationId,
        cylinderSizeKg: SIZE_KG,
        cylinderQuantity: quantity,
        deliveryAddress: "10 Somewhere St, Lagos",
      });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.request.id;

    const reviewed = await request(app)
      .put(`${LPG}/${id}/review`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ action: "approve", deliveryPrice: "500" });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    return id;
  }

  test("cancelling an approved order returns its cylinders to stock", async () => {
    const before = (await lpgStationRepo.getCylinderStock(stationId, SIZE_KG)).quantity;

    const id = await placeAndApprove(5);
    const afterApprove = (await lpgStationRepo.getCylinderStock(stationId, SIZE_KG)).quantity;
    assert.equal(afterApprove, before - 5, "approval decremented the cylinder stock");

    const cancelled = await request(app)
      .put(`${LPG}/${id}/cancel`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({});
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.data.request.status, "Cancelled");

    const afterCancel = (await lpgStationRepo.getCylinderStock(stationId, SIZE_KG)).quantity;
    assert.equal(afterCancel, before, "cancel returned the reserved cylinders — no leak");
  });

  test("cancelling a not-yet-approved order touches no stock", async () => {
    const before = (await lpgStationRepo.getCylinderStock(stationId, SIZE_KG)).quantity;

    const created = await request(app)
      .post(LPG)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({
        customerId,
        lpgStationId: stationId,
        cylinderSizeKg: SIZE_KG,
        cylinderQuantity: 4,
        deliveryAddress: "22 Pending St, Lagos",
      });
    const id = created.body.data.request.id;

    const cancelled = await request(app)
      .put(`${LPG}/${id}/cancel`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({});
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(
      (await lpgStationRepo.getCylinderStock(stationId, SIZE_KG)).quantity,
      before,
      "a Pending Review order never held stock, so nothing changes"
    );
  });

  test("a paid order cannot be cancelled", async () => {
    const id = await placeAndApprove(3);
    const paid = await request(app)
      .put(`${LPG}/${id}/payment-status`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ paymentStatus: "Paid" });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));

    const stockBefore = (await lpgStationRepo.getCylinderStock(stationId, SIZE_KG)).quantity;
    const res = await request(app)
      .put(`${LPG}/${id}/cancel`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({});
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(res.body.message, /paid/i);
    assert.equal(
      (await lpgStationRepo.getCylinderStock(stationId, SIZE_KG)).quantity,
      stockBefore,
      "a refused cancel restocks nothing"
    );
  });

  test("approving and cancelling are recorded in the audit trail", async () => {
    const id = await placeAndApprove(2);

    const afterApprove = await auditLogRepo.findByEntity("lpg_order_request", id);
    const approved = afterApprove.find((e) => e.newState === "Approved");
    assert.ok(approved, "the approval wrote an audit row");
    assert.equal(approved.prevState, "Pending Review");
    assert.equal(approved.actorType, "staff");

    await request(app)
      .put(`${LPG}/${id}/cancel`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({});

    const afterCancel = await auditLogRepo.findByEntity("lpg_order_request", id);
    const cancelled = afterCancel.find((e) => e.newState === "Cancelled");
    assert.ok(cancelled, "the cancellation wrote an audit row");
    assert.equal(cancelled.prevState, "Approved");
  });

  test("an already-approved order cannot be rejected (illegal transition)", async () => {
    const id = await placeAndApprove(2);
    const res = await request(app)
      .put(`${LPG}/${id}/review`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ action: "reject" });
    assert.equal(res.status, 409, JSON.stringify(res.body));
  });

  test("a second cancel is a no-op — cylinders are returned only once", async () => {
    const before = (await lpgStationRepo.getCylinderStock(stationId, SIZE_KG)).quantity;
    const id = await placeAndApprove(6);

    const first = await request(app)
      .put(`${LPG}/${id}/cancel`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({});
    assert.equal(first.status, 200);

    const second = await request(app)
      .put(`${LPG}/${id}/cancel`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({});
    assert.equal(second.status, 409, JSON.stringify(second.body));

    assert.equal(
      (await lpgStationRepo.getCylinderStock(stationId, SIZE_KG)).quantity,
      before,
      "stock is back to the start exactly once, not double-restocked"
    );
  });
});
