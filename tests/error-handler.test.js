// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { customerRepo } = require("../repositories");
const { staffToken, closeDb } = require("./helpers");

/** Nothing a client sees should ever contain a SQL fragment. */
function assertNoSqlLeak(res) {
  const body = JSON.stringify(res.body).toLowerCase();
  for (const fragment of ["select ", "update ", "insert into", "delete from", "returning "]) {
    assert.ok(
      !body.includes(fragment),
      `response leaked SQL (${fragment.trim()}): ${JSON.stringify(res.body).slice(0, 200)}`
    );
  }
}

describe("error handler — client mistakes are 4xx, and nothing leaks", () => {
  let token;
  let customerId;

  before(async () => {
    token = await staffToken(request, app);
    const existing = await customerRepo.findByPhone("+2348177000002");
    customerId =
      existing?.id ??
      (await customerRepo.create({
        name: "Error Fixture",
        phone: "+2348177000002",
        status: "Active",
      })).id;
  });

  after(async () => {
    await closeDb();
  });

  test("a non-numeric id is 400, not 500 with the query in the body", async () => {
    // Was: 500 carrying `select ... from "customers" where "id" = $1`.
    // Postgres 22P02, invalid_text_representation.
    const res = await request(app)
      .get("/api/customers/abc")
      .set("Authorization", `Bearer ${token}`);

    assert.equal(res.status, 400);
    assertNoSqlLeak(res);
  });

  test("a garbage numeric field is 400, not 500 with the UPDATE statement", async () => {
    // This is the probe that exposed the leak: the response body contained
    // the full `update "customers" set "balance" = $1 ... returning "id",
    // "name", "email", …` — the schema, handed to any caller.
    const res = await request(app)
      .patch(`/api/customers/${customerId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ balance: "not-a-number" });

    assert.equal(res.status, 400);
    assertNoSqlLeak(res);
    assert.ok(!JSON.stringify(res.body).includes("balance ="), "no fragment of the statement");
  });

  test("a duplicate phone is 409, not 500", async () => {
    const res = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Duplicate Attempt", phone: "+2348177000002" });

    // The controller catches this one itself; either way it must not be a 5xx
    // and must not echo the constraint's SQL.
    assert.equal(res.status, 409);
    assertNoSqlLeak(res);
  });

  test("a check-constraint violation surfaces as 400, not 500", async () => {
    // Drizzle wraps driver errors, so the SQLSTATE is on `.cause` — reading
    // err.code alone finds undefined and every violation became a 500.
    const res = await request(app)
      .patch(`/api/customers/${customerId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ balance: "-500" });

    assert.ok(res.status === 400, `expected 400, got ${res.status}`);
    assertNoSqlLeak(res);
  });

  test("a genuine 404 is still a 404", async () => {
    const res = await request(app)
      .get("/api/customers/99999999")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 404);
  });

  test("an unknown route is still a 404 with the standard envelope", async () => {
    const res = await request(app).get("/api/definitely-not-a-route");
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });

  test("every error response keeps the {success,message} envelope", async () => {
    const responses = await Promise.all([
      request(app).get("/api/customers/abc").set("Authorization", `Bearer ${token}`),
      request(app).get("/api/customers/99999999").set("Authorization", `Bearer ${token}`),
      request(app).get("/api/customers"),
    ]);

    for (const res of responses) {
      assert.equal(res.body.success, false, `status ${res.status} broke the envelope`);
      assert.equal(typeof res.body.message, "string");
      assert.ok(res.body.message.length > 0);
      assertNoSqlLeak(res);
    }
  });
});
