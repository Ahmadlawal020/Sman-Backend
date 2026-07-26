/**
 * Guards PR-0's contract: the rename must be behaviour-identical.
 *
 * These assert the *outside* of the system is unchanged, so a future
 * refactor cannot quietly alter the staff surface.
 */
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { staffToken, closeDb } = require("./helpers");

// every authenticated GET the dashboard relies on
const READ_ROUTES = [
  "/api/customers",
  "/api/products",
  "/api/depots",
  "/api/orders",
  "/api/trucks",
  "/api/drivers",
  "/api/pfis",
  "/api/tickets",
  "/api/deposits",
  "/api/delivery-customers",
  "/api/delivery-sales",
  "/api/delivery-inventory",
  "/api/filing-stations",
  "/api/dashboard/stats",
  "/api/dashboard/overview",
  "/api/admin",
];

describe("PR-0 — rename is behaviour-identical", () => {
  let token;

  before(async () => {
    token = await staffToken(request, app);
  });

  after(async () => {
    await closeDb();
  });

  for (const route of READ_ROUTES) {
    test(`GET ${route} still returns 200`, async () => {
      const res = await request(app)
        .get(route)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 200, `${route} returned ${res.status}`);
      assert.equal(res.body.success, true);
    });
  }

  test("/api/admin mount is preserved (public URL contract)", async () => {
    const res = await request(app)
      .get("/api/admin")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);
  });

  test("staff list dual-emits `staff` and legacy `admins`", async () => {
    const res = await request(app)
      .get("/api/admin")
      .set("Authorization", `Bearer ${token}`);

    assert.ok(Array.isArray(res.body.data.staff), "new `staff` key present");
    assert.ok(
      Array.isArray(res.body.data.admins),
      "legacy `admins` key retained for the existing frontend"
    );
    assert.deepEqual(
      res.body.data.staff,
      res.body.data.admins,
      "both keys carry identical payloads"
    );
  });

  test("the 403 message for an under-privileged role is unchanged", async () => {
    // Goes through the real issue path: tokens now carry a `sid` bound to a
    // live session, so a hand-signed JWT is rejected before authorisation is
    // ever reached and would not exercise this assertion.
    const { staffTokenWithRoles } = require("./helpers");
    const { accessToken } = await staffTokenWithRoles(["finance"]);

    const res = await request(app)
      .get("/api/customers")
      .set("Authorization", `Bearer ${accessToken}`);

    assert.equal(res.status, 403);
    assert.equal(res.body.message, "Admin access required");
  });
});
