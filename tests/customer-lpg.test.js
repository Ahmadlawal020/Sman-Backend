// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { customerRepo } = require("../repositories");
const { NATIVE_TRANSPORT, closeDb } = require("./helpers");
const { seedLpgStation } = require("./liveFixtures");

const PORTAL_AUTH = "/api/customer/auth";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();
const SIZE_KG = 12;

async function registerActiveCustomer(tag) {
  // 816, not the 817/818 ranges other suites mint from — concurrent runs on
  // the shared test DB must never race each other's OTP rows for one phone.
  const phone = `+234816${String(RUN).slice(-6)}${tag}`;
  const reg = await request(app).post(`${PORTAL_AUTH}/register`).send({ name: `LPG ${tag}`, phone });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const ver = await request(app)
    .post(`${PORTAL_AUTH}/verify-otp`)
    .set(NATIVE_TRANSPORT)
    .send({ phone, code: DEV_CODE });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  const customer = await customerRepo.findByPhone(phone);
  return { customer, accessToken: ver.body.data.accessToken };
}

describe("customer portal — LPG cooking gas", () => {
  let stationId;

  before(async () => {
    // Live schema: the station is consumer_lpgplant (+ sman.lpg_station_extras
    // for address fields) and cylinder stock is sman.lpg_station_cylinders —
    // seedLpgStation speaks that vocabulary through lpgStationRepo.
    const station = await seedLpgStation({
      name: `Customer LPG Station ${RUN}`,
      code: `C${String(RUN).slice(-6)}`,
      address: "1 Gas Rd",
      city: "Lagos",
      state: "Lagos",
      country: "NG",
      postcode: "100001",
      pricePerKg: "1200",
      establishedYear: "2020",
      cylinders: [{ cylinderSizeKg: SIZE_KG, quantity: 40 }],
    });
    stationId = station.id;
  });

  after(async () => {
    await closeDb();
  });

  const orderBody = () => ({
    lpgStationId: stationId,
    cylinderSizeKg: SIZE_KG,
    cylinderQuantity: 2,
    deliveryAddress: "10 Somewhere St, Lagos",
  });

  test("the public LPG catalog lists open stations with price and stock", async () => {
    const res = await request(app).get("/api/lpg-catalog");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const station = res.body.data.stations.find((s) => s.id === stationId);
    assert.ok(station, "the station is in the catalog");
    assert.equal(station.pricePerKg, 1200);
    assert.equal(station.state, "Lagos", "the extras-side state is exposed");
    assert.ok(
      station.cylinders.some((c) => c.sizeKg === SIZE_KG && c.available === 40),
      "cylinder size and availability are shown"
    );
  });

  test("a customer places their own LPG request (Pending Review)", async () => {
    const { customer, accessToken } = await registerActiveCustomer("1");
    const res = await request(app)
      .post("/api/customer/lpg-orders")
      .set("Authorization", `Bearer ${accessToken}`)
      .send(orderBody());
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.request.status, "Pending Review");
    assert.equal(res.body.data.request.customerId, customer.id, "the request is the caller's own");
  });

  test("a customer sees their own requests but not another customer's", async () => {
    const a = await registerActiveCustomer("2");
    const b = await registerActiveCustomer("3");

    const placed = await request(app)
      .post("/api/customer/lpg-orders")
      .set("Authorization", `Bearer ${a.accessToken}`)
      .send(orderBody());
    const id = placed.body.data.request.id;

    const list = await request(app)
      .get("/api/customer/lpg-orders")
      .set("Authorization", `Bearer ${a.accessToken}`);
    assert.equal(list.status, 200);
    assert.ok(list.body.data.stations === undefined);
    assert.ok(
      list.body.data.requests.every((r) => r.customerId === a.customer.id),
      "the list is scoped to the caller"
    );

    const own = await request(app)
      .get(`/api/customer/lpg-orders/${id}`)
      .set("Authorization", `Bearer ${a.accessToken}`);
    assert.equal(own.status, 200);

    const foreign = await request(app)
      .get(`/api/customer/lpg-orders/${id}`)
      .set("Authorization", `Bearer ${b.accessToken}`);
    assert.equal(foreign.status, 404, "another customer's request is a flat 404");
  });

  test("placing an LPG request requires authentication", async () => {
    const res = await request(app).post("/api/customer/lpg-orders").send(orderBody());
    assert.equal(res.status, 401);
  });
});
