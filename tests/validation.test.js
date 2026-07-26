// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { z } = require("zod");

const app = require("../app");
const { customerRepo } = require("../repositories");
const fields = require("../schemas/fields");
const { staffToken, closeDb } = require("./helpers");

describe("validation — schemas as whitelists, and safe coercion", () => {
  let token;
  let customerId;

  before(async () => {
    token = await staffToken(request, app);
    const existing = await customerRepo.findByPhone("+2348188000001");
    customerId =
      existing?.id ??
      (
        await customerRepo.create({
          name: "Validation Fixture",
          phone: "+2348188000001",
          status: "Active",
        })
      ).id;
  });

  after(async () => {
    await closeDb();
  });

  // --- the coercion trap ---------------------------------------------------

  describe("numeric coercion is narrower than z.coerce", () => {
    // z.coerce.number() applies JavaScript's Number() semantics, so "" , null,
    // true, [] and [5] all become numbers. `{"quantity": []}` would have been
    // an order for zero litres, silently accepted.
    const dangerous = [
      ["empty string", ""],
      ["whitespace", " "],
      ["null", null],
      ["true", true],
      ["false", false],
      ["empty array", []],
      ["array with a number", [5]],
      ["object", {}],
      ["hex string", "0x10"],
      ["Infinity string", "Infinity"],
      ["overflow exponent", "1e400"],
    ];

    for (const [label, value] of dangerous) {
      test(`quantity rejects ${label}`, () => {
        assert.equal(fields.quantity.safeParse(value).success, false);
      });
    }

    test("but a real number and a numeric string both work", () => {
      assert.equal(fields.quantity.parse(500), 500);
      assert.equal(fields.quantity.parse("500"), 500);
      assert.equal(fields.quantity.parse(" 500 "), 500, "clients send padded form values");
    });

    test("quantity must be a positive whole number", () => {
      for (const bad of [0, -1, "500.5", 1.5]) {
        assert.equal(fields.quantity.safeParse(bad).success, false, `${bad} should fail`);
      }
    });
  });

  // --- money ---------------------------------------------------------------

  describe("money matches numeric(15,2)", () => {
    const money = fields.money();

    test("normalises to two decimal places as a string", () => {
      assert.equal(money.parse("100"), "100.00");
      assert.equal(money.parse("100.5"), "100.50");
      assert.equal(money.parse(100.5), "100.50");
      assert.equal(money.parse("0"), "0.00");
    });

    test("stays a string end to end — never a float", () => {
      // The driver takes a string; passing a JS number risks precision loss.
      assert.equal(typeof money.parse(1234.56), "string");
    });

    test("rejects more precision than the column holds", () => {
      assert.equal(money.safeParse("1.005").success, false);
      assert.equal(money.safeParse("0.001").success, false);
    });

    test("rejects values wider than 13 integer digits", () => {
      // numeric(15,2) is 15 digits of precision, 2 after the point.
      assert.equal(money.safeParse("9".repeat(13)).success, true);
      assert.equal(money.safeParse("9".repeat(14)).success, false);
    });

    test("rejects negatives, NaN and Infinity", () => {
      for (const bad of ["-1", -1, NaN, Infinity, -Infinity, "abc", "", null, true, []]) {
        assert.equal(money.safeParse(bad).success, false, `${String(bad)} should fail`);
      }
    });

    test("a minimum can be required, for amounts that must be non-zero", () => {
      const positive = fields.money({ min: 0.01 });
      assert.equal(positive.safeParse("0").success, false);
      assert.equal(positive.safeParse("0.01").success, true);
    });
  });

  // --- whitelisting --------------------------------------------------------

  test("unknown body keys are stripped, not stored", async () => {
    // This is what closes mass assignment on a validated route.
    const res = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Whitelist Test",
        phone: "08188000002",
        balance: "999999",
        virtualAccountNumber: "0123456789",
        paystackCustomerId: "CUS_hijack",
      });

    assert.equal(res.status, 201);
    const created = await customerRepo.findByPhone("+2348188000002");

    // `balance` IS in the schema, so it is honoured — but the two fields that
    // are not in the schema never reach the insert. Overwriting
    // virtualAccountNumber would redirect another customer's payments, since
    // the webhook matches on account number.
    assert.equal(created.virtualAccountNumber, "", "not settable from the request");
    assert.equal(created.paystackCustomerId, "", "not settable from the request");
    await customerRepo.deleteById(created.id);
  });

  test("a client-supplied price cannot reach order creation", () => {
    const orderSchemas = require("../schemas/order.schema");
    const parsed = orderSchemas.createOrder.parse({
      customer: 1,
      depot: 1,
      product: 1,
      state: "Lagos",
      quantity: 100,
      deliveryType: "pickup",
      price: "0.01",
      totalAmount: "1",
    });

    assert.equal(parsed.price, undefined, "stripped before the controller sees it");
    assert.equal(parsed.totalAmount, undefined);
  });

  // --- HTTP surface --------------------------------------------------------

  test("a bad body returns 400 with field-level errors", async () => {
    const res = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: 12345, phone: "" });

    assert.equal(res.status, 400);
    assert.equal(res.body.message, "Validation failed");
    assert.ok(Array.isArray(res.body.errors));
    assert.ok(
      res.body.errors.some((e) => e.path === "name"),
      `expected a name error, got ${JSON.stringify(res.body.errors)}`
    );
    assert.ok(res.body.errors.every((e) => typeof e.message === "string"));
  });

  test("a non-numeric id is rejected at the edge, before Postgres", async () => {
    const res = await request(app)
      .get("/api/customers/abc")
      .set("Authorization", `Bearer ${token}`);

    assert.equal(res.status, 400);
    assert.equal(res.body.message, "Validation failed", "caught by the schema, not the driver");
  });

  test("query parameters are coerced and unknown ones dropped", async () => {
    // Express 5 exposes req.query as a getter: assigning to it silently does
    // nothing, so validate() edits it in place. If that broke, `limit` would
    // still be the string "5" and unknown keys would survive.
    const res = await request(app)
      .get("/api/customers?page=1&limit=5&bogus=keepme")
      .set("Authorization", `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.ok(res.body.data.customers.length <= 5, "the coerced limit was applied");
  });

  test("an out-of-range limit is rejected rather than clamped silently", async () => {
    const res = await request(app)
      .get("/api/customers?limit=100000")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 400);
  });

  test("an invalid enum value is refused", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        customer: customerId,
        depot: 1,
        product: 1,
        state: "Lagos",
        quantity: 100,
        deliveryType: "teleportation",
      });

    assert.equal(res.status, 400);
    assert.ok(res.body.errors.some((e) => e.path === "deliveryType"));
  });

  // --- the price gate ------------------------------------------------------

  test("repricing fuel now requires finance, not just admin", async () => {
    const { staffTokenWithRoles } = require("./helpers");
    const { accessToken } = await staffTokenWithRoles(["admin"], "test-plain-admin@soroman.test");

    const res = await request(app)
      .patch("/api/depots/1/product-price")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ productId: 1, price: "0.01" });

    assert.equal(res.status, 403, "a plain admin must not be able to reprice fuel");
    assert.match(res.body.message, /finance/i);
  });

  test("a zero price is refused — it would make every order at that depot free", () => {
    const depotSchemas = require("../schemas/depot.schema");
    assert.equal(
      depotSchemas.updateProductPrice.safeParse({ productId: 1, price: "0" }).success,
      false
    );
  });
});
