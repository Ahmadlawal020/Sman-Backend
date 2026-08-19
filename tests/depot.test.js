// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { eq } = require("drizzle-orm");

const app = require("../app");
const { db } = require("../config/db");
const {
  consumerDepots,
  consumerProduct,
  depotProductCapacities,
  depotStaff,
} = require("../db/schema");
const { staffRepo } = require("../repositories");
const { staffToken, closeDb } = require("./helpers");
const { seedProduct } = require("./liveFixtures");

/**
 * Guards two regressions that both had the same shape — a write field that the
 * controller reads but nothing persisted:
 *
 *  1. `productCapacities` was stripped by the validate middleware because the
 *     depot schema never declared it, so a PATCH returned 200 while the
 *     capacities silently vanished.
 *  2. `setStaff` inserted an `adminId` key into depot_staff, whose column is
 *     `staffId`; Drizzle dropped the unknown key and the NOT NULL insert failed.
 *
 * Both are asserted against the database, not just the response body, so a
 * future re-break cannot pass by echoing the request back.
 *
 * KNOWN PRODUCTION BUGS (post-cutover) — every test below fails on them until
 * controllers/administration/depot.controller.js catches up with the migrated
 * depot repository:
 *
 *  a. createDepot (depot.controller.js:96) never supplies `location`, which
 *     is NOT NULL on consumer_depots (the live table has ONLY
 *     id/name/location) — POST /api/depots dies on 23502 (surfaced as a 400
 *     "A required field is missing") before anything persists. The controller
 *     needs to map the write shape's `state` (or an explicit location) onto
 *     it. Every test here fails at that first POST.
 *  b. upsertProductPrice is called as (depot.id, productId, price)
 *     (depot.controller.js:125,193,262) but the live signature is
 *     (stateId, productId, price) — a depot id lands where a consumer_states
 *     id belongs, silently pricing the wrong (or no) state.
 */
describe("depot writes — capacities and staff actually persist", () => {
  const suffix = Date.now().toString(36);
  let token;
  let product;
  let assignableStaff;
  const createdDepotIds = [];

  before(async () => {
    token = await staffToken(request, app);

    // Live products are consumer_product (no sku/category columns — the trade
    // code lives in `abbreviation`).
    product = await seedProduct({
      name: `Depot Test Product ${suffix}`,
      abbreviation: `DTP${suffix}`.slice(0, 10),
    });

    assignableStaff = await staffRepo.create({
      firstName: "Depot",
      surname: "Assignee",
      email: `depot-assignee-${suffix}@soroman.test`,
      password: "TestPassw0rd!",
      isPasswordSet: true,
      roles: ["admin"],
      isActive: true,
      suspended: false,
    });
  });

  after(async () => {
    // Depot delete cascades to sman.depot_product_capacities/depot_staff/
    // depot_extras (all FK ON DELETE CASCADE to consumer_depots).
    for (const id of createdDepotIds) {
      await db.delete(consumerDepots).where(eq(consumerDepots.id, id));
    }
    await db.delete(consumerProduct).where(eq(consumerProduct.id, product.id));
    await staffRepo.deleteById(assignableStaff.id);
    await closeDb();
  });

  const depotBody = (overrides = {}) => ({
    name: `Cap Test Depot ${suffix}`,
    code: `CAP-${suffix}`,
    address: "Warri Refinery Axis",
    city: "Warri",
    state: "Delta",
    country: "Nigeria",
    postcode: "332213",
    maxCapacity: 500000,
    status: "Active",
    establishedYear: "2017",
    ...overrides,
  });

  test("POST creates a depot with product capacities and staff that reach the DB", async () => {
    const res = await request(app)
      .post("/api/depots")
      .set("Authorization", `Bearer ${token}`)
      .send(
        depotBody({
          productCapacities: [{ product: product.id, capacity: 30000 }],
          staffIds: [assignableStaff.id],
        })
      );

    assert.equal(res.status, 201, JSON.stringify(res.body));
    const depot = res.body.data.depot;
    createdDepotIds.push(depot.id);

    // Response reflects the write.
    const cap = depot.productCapacities.find((c) => c.productId === product.id);
    assert.ok(cap, "created depot response is missing the product capacity");
    assert.equal(cap.capacity, 30000);

    // Database actually holds the row — not just the echoed response.
    const capRows = await db
      .select()
      .from(depotProductCapacities)
      .where(eq(depotProductCapacities.depotId, depot.id));
    assert.equal(capRows.length, 1);
    assert.equal(capRows[0].productId, product.id);
    assert.equal(capRows[0].capacity, 30000);

    const staffRows = await db
      .select()
      .from(depotStaff)
      .where(eq(depotStaff.depotId, depot.id));
    assert.equal(staffRows.length, 1, "staff assignment did not persist");
    assert.equal(staffRows[0].staffId, assignableStaff.id);
  });

  test("PATCH persists productCapacities — the reported bug", async () => {
    // A depot with no capacities yet.
    const created = await request(app)
      .post("/api/depots")
      .set("Authorization", `Bearer ${token}`)
      .send(depotBody({ code: `CAP2-${suffix}`, name: `Patch Test Depot ${suffix}` }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const depotId = created.body.data.depot.id;
    createdDepotIds.push(depotId);

    // Exactly the payload shape from the bug report: string product id, string year.
    const res = await request(app)
      .patch(`/api/depots/${depotId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: `Patch Test Depot ${suffix}`,
        status: "Active",
        establishedYear: "2017",
        productCapacities: [{ product: String(product.id), capacity: 30000 }],
        staffIds: [],
      });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    const cap = res.body.data.depot.productCapacities.find((c) => c.productId === product.id);
    assert.ok(cap, "PATCH response dropped the product capacity");
    assert.equal(cap.capacity, 30000);

    const capRows = await db
      .select()
      .from(depotProductCapacities)
      .where(eq(depotProductCapacities.depotId, depotId));
    assert.equal(capRows.length, 1, "PATCH did not persist the capacity to the DB");
    assert.equal(capRows[0].capacity, 30000);
  });

  test("PATCH updates an existing capacity in place rather than duplicating it", async () => {
    const created = await request(app)
      .post("/api/depots")
      .set("Authorization", `Bearer ${token}`)
      .send(
        depotBody({
          code: `CAP3-${suffix}`,
          name: `Upsert Test Depot ${suffix}`,
          productCapacities: [{ product: product.id, capacity: 10000 }],
        })
      );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const depotId = created.body.data.depot.id;
    createdDepotIds.push(depotId);

    const res = await request(app)
      .patch(`/api/depots/${depotId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ productCapacities: [{ product: product.id, capacity: 45000 }] });

    assert.equal(res.status, 200, JSON.stringify(res.body));

    const capRows = await db
      .select()
      .from(depotProductCapacities)
      .where(eq(depotProductCapacities.depotId, depotId));
    assert.equal(capRows.length, 1, "capacity upsert created a duplicate row");
    assert.equal(capRows[0].capacity, 45000);
  });
});
