// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { closeDb } = require("./helpers");
const { seedState, seedProduct, seedPrice, seedDepot, seedPfi } = require("./liveFixtures");

const CATALOG = "/api/catalog";
const RUN = Date.now();

describe("public catalog — what anyone may see before signing in", () => {
  let stockedDepotId;
  let emptyDepotId;
  let stockedStateName;
  let productId;

  before(async () => {
    // Live model: pricing and stock are STATE-scoped (consumer_productprice
    // per product+state, stock from active PFIs whose locationId is a state),
    // and a depot joins the catalog via location === state name. Two states:
    // both priced, only one with an active PFI — so only the depot in the
    // stocked state is orderable.
    const stockedState = await seedState({ name: `Catalog Stocked State ${RUN}` });
    const emptyState = await seedState({ name: `Catalog Empty State ${RUN}` });
    stockedStateName = stockedState.name;

    const stocked = await seedDepot({ name: "Catalog Stocked Depot", location: stockedState.name });
    stockedDepotId = stocked.id;
    const empty = await seedDepot({ name: "Catalog Empty Depot", location: emptyState.name });
    emptyDepotId = empty.id;

    // `abbreviation` is the live home of the trade code the portal shows as a
    // badge (there is no sku column — catalog.service derives sku/code from
    // abbreviation). The dashes prove the badge strips punctuation.
    const product = await seedProduct({
      name: "Catalog PMS",
      abbreviation: `CAT-PMS-${String(RUN).slice(-5)}`,
    });
    productId = product.id;

    await seedPrice(productId, stockedState.id, { price: "150.00" });
    await seedPrice(productId, emptyState.id, { price: "150.00" });

    // Only the stocked state gets an active PFI — the sellable-stock source.
    await seedPfi({ productId, locationId: stockedState.id, status: "active" });
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

  test("exposes the payment window hours from ORDER_EXPIRY_HOURS", async () => {
    const original = process.env.ORDER_EXPIRY_HOURS;
    try {
      process.env.ORDER_EXPIRY_HOURS = "12";
      const res = await request(app).get(CATALOG);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.orderExpiryHours, 12);
    } finally {
      if (original === undefined) delete process.env.ORDER_EXPIRY_HOURS;
      else process.env.ORDER_EXPIRY_HOURS = original;
    }
  });

  test("an in-stock priced depot is listed with its products and prices", async () => {
    const res = await request(app).get(CATALOG);
    const depot = res.body.data.depots.find((d) => d.id === stockedDepotId);
    assert.ok(depot, "the stocked depot is in the catalog");
    assert.equal(depot.state, stockedStateName);

    const product = depot.products.find((p) => p.id === productId);
    assert.ok(product, "its priced product is listed");
    assert.equal(product.price, 150);
    assert.equal(product.unit, "Liters");
    assert.equal(product.name, "Catalog PMS");

    // The badge comes from the abbreviation, punctuation stripped — never
    // from a category. Sending a classification here is exactly the
    // regression that made the mobile app show a product called Petrol with
    // a badge reading "Fuel".
    const expectedCode = `CATPMS${String(RUN).slice(-5)}`;
    assert.equal(product.code, expectedCode, "the trade code the portal shows as a badge");
    assert.equal(product.sku, `CAT-PMS-${String(RUN).slice(-5)}`, "the raw abbreviation is exposed as sku");
    assert.notEqual(product.code, "Fuel", "the badge must never be a product classification");
    // Legacy alias kept for shipped mobile builds that still read `category`.
    assert.equal(product.category, expectedCode, "category mirrors the code for old clients");
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
