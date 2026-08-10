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

  test("an under-privileged role still gets a 403 with a stable message", async () => {
    // Goes through the real issue path: tokens now carry a `sid` bound to a
    // live session, so a hand-signed JWT is rejected before authorisation is
    // ever reached and would not exercise this assertion.
    //
    // Rewritten for config/apiPermissions. The old form used `finance` against
    // /api/customers and expected "Admin access required" — both were artefacts
    // of the flat admin/super_admin gate. Finance is now a legitimate customers
    // reader, and the denial wording comes from the permission table. The point
    // of the test is unchanged: a role outside the read list is refused, and the
    // message it gets is a fixed string clients can branch on.
    const { staffTokenWithRoles } = require("./helpers");
    // Own fixture row — see the note in staff-auth.test.js. These were the only
    // two callers still on the helper's shared default.
    const { accessToken } = await staffTokenWithRoles(
      ["security_entry"],
      "test-underprivileged@soroman.test"
    );

    const res = await request(app)
      .get("/api/customers")
      .set("Authorization", `Bearer ${accessToken}`);

    assert.equal(res.status, 403);
    assert.equal(res.body.message, "Your role does not have access to this area");
  });
});
