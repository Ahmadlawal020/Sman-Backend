const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { TEST_STAFF, staffToken, closeDb } = require("./helpers");

describe("staff authentication", () => {
  let token;

  before(async () => {
    token = await staffToken(request, app);
  });

  after(async () => {
    await closeDb();
  });

  test("login with valid credentials returns an access token", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: TEST_STAFF.email, password: TEST_STAFF.password });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.accessToken, "accessToken present");
    assert.ok(res.body.data.refreshToken, "refreshToken present");
  });

  test("login with a wrong password is rejected", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: TEST_STAFF.email, password: "wrong-password" });

    assert.equal(res.status, 401);
    // must not distinguish unknown-email from wrong-password
    assert.equal(res.body.message, "Invalid credentials");
  });

  test("login with an unknown email gives the same response", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@soroman.test", password: "whatever" });

    assert.equal(res.status, 401);
    assert.equal(res.body.message, "Invalid credentials");
  });

  test("missing body fields are rejected cleanly, not with a crash", async () => {
    const res = await request(app).post("/api/auth/login").send({});
    assert.equal(res.status, 400);
  });

  test("/auth/me returns the authenticated staff member", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.email, TEST_STAFF.email);
    assert.ok(!("password" in res.body.data.user), "password never serialized");
    assert.ok(
      !("refreshToken" in res.body.data.user),
      "refreshToken never serialized"
    );
  });
});

describe("route protection", () => {
  test("a protected route without a token is 401", async () => {
    const res = await request(app).get("/api/customers");
    assert.equal(res.status, 401);
  });

  test("a protected route with a garbage token is 403", async () => {
    const res = await request(app)
      .get("/api/customers")
      .set("Authorization", "Bearer not-a-real-token");
    assert.equal(res.status, 403);
  });

  test("an unknown route is 404", async () => {
    const res = await request(app).get("/api/does-not-exist");
    assert.equal(res.status, 404);
  });

  test("the root path is 404, not a hang (Express 5 /{*splat})", async () => {
    const res = await request(app).get("/");
    assert.equal(res.status, 404);
  });
});
