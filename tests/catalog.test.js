// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { db } = require("../config/db");
const { depots, products, depotProductPrices, pfis } = require("../db/schema");
const { closeDb } = require("./helpers");

const CATALOG = "/api/catalog";
const RUN = Date.now();

const seedDepot = async (name, code) => {
  const [depot] = await db
    .insert(depots)
    .values({
      name,
      code,
      address: "1 Rd",
      city: "Lagos",
      state: "Lagos",
      country: "NG",
      postcode: "100001",
      maxCapacity: 10000000,
      establishedYear: "2020",
    })
    .returning();
  return depot;
};

describe("public catalog — what anyone may see before signing in", () => {
  let stockedDepotId;
  let emptyDepotId;
  let productId;

  before(async () => {
    const stocked = await seedDepot("Catalog Stocked Depot", `CAT${String(RUN).slice(-5)}`);
    stockedDepotId = stocked.id;
    const empty = await seedDepot("Catalog Empty Depot", `CAE${String(RUN).slice(-5)}`);
    emptyDepotId = empty.id;

    const [product] = await db
      .insert(products)
      .values({ name: "Catalog PMS", sku: `CAT-PMS-${String(RUN).slice(-5)}`, category: "PMS" })
      .returning();
    productId = product.id;

    // Both depots carry a price; only the stocked one has an active PFI, so
    // only the stocked one is orderable.
    await db.insert(depotProductPrices).values([
      { depotId: stockedDepotId, productId, currentPrice: "150" },
      { depotId: emptyDepotId, productId, currentPrice: "150" },
    ]);
    await db.insert(pfis).values({
      pfiNumber: `PFI-CAT-${RUN}`,
      status: "active",
      locationId: stockedDepotId,
      productId,
      startingQtyLitres: 500000,
      soldQtyLitres: 0,
    });
  });

  after(async () => {
    await closeDb();
  });

  test("no authentication is required", async () => {
    const res = await request(app).get(CATALOG);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data.depots));
  });

  test("an in-stock priced depot is listed with its products and prices", async () => {
    const res = await request(app).get(CATALOG);
    const depot = res.body.data.depots.find((d) => d.id === stockedDepotId);
    assert.ok(depot, "the stocked depot is in the catalog");
    assert.equal(depot.state, "Lagos");

    const product = depot.products.find((p) => p.id === productId);
    assert.ok(product, "its priced product is listed");
    assert.equal(product.price, 150);
    assert.equal(product.unit, "Liters");
    assert.equal(product.name, "Catalog PMS");
    assert.equal(product.category, "PMS", "the trade code the portal shows as a badge");
  });

  test("stock litres never leave the process", async () => {
    const res = await request(app).get(CATALOG);
    for (const depot of res.body.data.depots) {
      for (const product of depot.products) {
        assert.ok(!("stock" in product), `stock leaked for product ${product.id} at depot ${depot.id}`);
      }
    }
  });

  test("a depot with a price but no active stock is not listed at all", async () => {
    const res = await request(app).get(CATALOG);
    const depot = res.body.data.depots.find((d) => d.id === emptyDepotId);
    assert.equal(depot, undefined, "the empty depot must not appear");
  });
});
