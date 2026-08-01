// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { closeDb } = require("./helpers");

// The public catalog route the wizard loads its product tiles from.
describe("catalog — public Dangote delivery products", () => {
  after(async () => {
    await closeDb();
  });

  test("GET /api/catalog/dangote-products returns active PMS/AGO/LPG with code + unit", async () => {
    const res = await request(app).get("/api/catalog/dangote-products");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const products = res.body.data.products;
    assert.ok(Array.isArray(products) && products.length >= 3, "at least PMS/AGO/LPG");

    const byCode = Object.fromEntries(products.map((p) => [p.code, p]));
    for (const code of ["PMS", "AGO", "LPG"]) {
      assert.ok(byCode[code], `missing ${code}`);
      assert.ok(byCode[code].id, `${code} needs a catalog id`);
      assert.ok(byCode[code].name, `${code} needs a name`);
    }
    assert.equal(byCode.PMS.unit, "litre");
    assert.equal(byCode.AGO.unit, "litre");
    assert.equal(byCode.LPG.unit, "kg");

    // Never leaks Soroman depot products.
    assert.ok(
      products.every((p) => ["PMS", "AGO", "LPG"].includes(p.code)),
      "only Dangote delivery codes"
    );
    // No storage-irrelevant internals; just what the wizard needs.
    assert.deepEqual(Object.keys(byCode.PMS).sort(), ["code", "id", "name", "unit"]);
  });

  test("the route is public (no auth required)", async () => {
    const res = await request(app).get("/api/catalog/dangote-products");
    assert.equal(res.status, 200);
  });
});
