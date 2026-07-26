// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { db } = require("../config/db");
const { customerOtps, customers } = require("../db/schema");
const { eq } = require("drizzle-orm");
const { customerRepo, sessionRepo } = require("../repositories");
const { TEST_STAFF, ensureTestStaff, closeDb } = require("./helpers");

const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const PORTAL = "/api/customer/auth";

/**
 * Whole-journey tests.
 *
 * Every step here is covered somewhere by a focused test. These exist because
 * passing in isolation is not the same as composing: state has to survive
 * across calls, one step's output has to be the next step's input, and
 * revocation has to hold for everything downstream. A tester signing off on
 * "the authentication system" walks these, not the unit assertions.
 */
describe("end-to-end journeys", () => {
  after(async () => {
    await closeDb();
  });

  test("staff: sign in, work, rotate, sign out everywhere", async () => {
    await ensureTestStaff();

    // 1. Sign in.
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: TEST_STAFF.email, password: TEST_STAFF.password });
    assert.equal(login.status, 200, "sign in");
    const first = login.body.data;
    assert.ok(first.accessToken && first.refreshToken);

    // 2. Identify.
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${first.accessToken}`);
    assert.equal(me.status, 200, "identify");
    assert.equal(me.body.data.user.email, TEST_STAFF.email);
    assert.equal(me.body.data.user.password, undefined, "credentials never serialised");
    assert.equal(me.body.data.user.refreshToken, undefined);

    // 3. Do actual work behind the elevated guard.
    const work = await request(app)
      .get("/api/customers")
      .set("Authorization", `Bearer ${first.accessToken}`);
    assert.equal(work.status, 200, "read a protected resource");

    // 4. Rotate.
    const refreshed = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: first.refreshToken });
    assert.equal(refreshed.status, 200, "rotate");
    const second = refreshed.body.data;
    assert.notEqual(second.refreshToken, first.refreshToken);
    assert.notEqual(second.accessToken, first.accessToken);

    // 5. The new access token works.
    assert.equal(
      (await request(app).get("/api/auth/me").set("Authorization", `Bearer ${second.accessToken}`))
        .status,
      200,
      "the rotated access token works"
    );

    // 6. The session appears in the device list and is marked current.
    const sessions = await request(app)
      .get("/api/auth/sessions")
      .set("Authorization", `Bearer ${second.accessToken}`);
    assert.equal(sessions.status, 200);
    assert.ok(sessions.body.data.sessions.some((s) => s.current), "current device is marked");

    // 7. Sign out everywhere.
    const out = await request(app)
      .post("/api/auth/logout-all")
      .set("Authorization", `Bearer ${second.accessToken}`);
    assert.equal(out.status, 200, "sign out everywhere");

    // 8. Everything downstream is dead — including the still-unexpired token.
    assert.equal(
      (await request(app).get("/api/auth/me").set("Authorization", `Bearer ${second.accessToken}`))
        .status,
      401,
      "the access token stops working immediately"
    );
    assert.equal(
      (await request(app).post("/api/auth/refresh").send({ refreshToken: second.refreshToken }))
        .status,
      403,
      "and the refresh token cannot revive it"
    );
  });

  test("customer: register, verify, browse, manage devices, sign out", async () => {
    const phone = "+2348133000001";

    // Clean slate: the SQL-backed budgets count real rows over a rolling hour.
    await db.delete(customerOtps);
    const stale = await customerRepo.findByPhone(phone);
    if (stale) await customerRepo.deleteById(stale.id);

    // 1. Register. Unknown number, so a row is created as Pending.
    const registered = await request(app)
      .post(`${PORTAL}/register`)
      .send({ phone, name: "Grace Hopper", companyName: "Compiler Co" });
    assert.equal(registered.status, 200, "register");

    const created = await customerRepo.findByPhone(phone);
    assert.ok(created, "customer created");
    assert.equal(created.status, "Pending", "registered, but the number is not yet proven");
    assert.equal(created.phoneVerifiedAt, null, "phone unverified until the code is used");

    // 2. Verify the code. Proving control of the number IS the activation
    //    gate — no staff approval step exists.
    const verified = await request(app)
      .post(`${PORTAL}/verify-otp`)
      .send({ phone, code: DEV_CODE });
    assert.equal(verified.status, 200, "verify");
    const deviceOne = verified.body.data;
    assert.ok(deviceOne.accessToken && deviceOne.refreshToken);
    assert.ok(deviceOne.customer.phoneVerifiedAt, "phone now verified");
    assert.equal(deviceOne.customer.status, "Active", "activated by proving the number");

    // 3. Browse.
    const me = await request(app)
      .get(`${PORTAL}/me`)
      .set("Authorization", `Bearer ${deviceOne.accessToken}`);
    assert.equal(me.status, 200, "signed in");
    assert.equal(me.body.data.customer.name, "Grace Hopper");

    // 4. Sign in from a second device, via login rather than register.
    await request(app).post(`${PORTAL}/request-otp`).send({ phone });
    const secondLogin = await request(app)
      .post(`${PORTAL}/verify-otp`)
      .send({ phone, code: DEV_CODE });
    assert.equal(secondLogin.status, 200, "sign in on a second device");
    const deviceTwo = secondLogin.body.data;

    // 5. Both devices are listed.
    const list = await request(app)
      .get(`${PORTAL}/sessions`)
      .set("Authorization", `Bearer ${deviceTwo.accessToken}`);
    assert.equal(list.status, 200);
    assert.ok(list.body.data.sessions.length >= 2, "both devices visible");

    // 6. Revoke the first device from the second.
    const firstSession = await sessionRepo.findByToken("customer", deviceOne.refreshToken);
    const revoke = await request(app)
      .delete(`${PORTAL}/sessions/${firstSession.id}`)
      .set("Authorization", `Bearer ${deviceTwo.accessToken}`);
    assert.equal(revoke.status, 200, "revoke a device");

    assert.equal(
      (await request(app).get(`${PORTAL}/me`).set("Authorization", `Bearer ${deviceOne.accessToken}`))
        .status,
      401,
      "the revoked device is locked out"
    );
    assert.equal(
      (await request(app).get(`${PORTAL}/me`).set("Authorization", `Bearer ${deviceTwo.accessToken}`))
        .status,
      200,
      "the other device is unaffected"
    );

    // 7. Rotate on the surviving device.
    const rotated = await request(app)
      .post(`${PORTAL}/refresh`)
      .send({ refreshToken: deviceTwo.refreshToken });
    assert.equal(rotated.status, 200, "rotate");

    // 8. A staff-side deactivation reaches the live session without re-login,
    //    because status is read from the row rather than baked into the token.
    await customerRepo.update(created.id, { status: "Inactive" });
    const afterDeactivation = await request(app)
      .get(`${PORTAL}/me`)
      .set("Authorization", `Bearer ${rotated.body.data.accessToken}`);
    assert.equal(
      afterDeactivation.status,
      401,
      "deactivation takes effect immediately, not at token expiry"
    );
    await customerRepo.update(created.id, { status: "Active" });

    // 9. Sign out.
    const out = await request(app)
      .post(`${PORTAL}/logout`)
      .send({ refreshToken: rotated.body.data.refreshToken });
    assert.equal(out.status, 200, "sign out");
    assert.equal(
      (await request(app)
        .get(`${PORTAL}/me`)
        .set("Authorization", `Bearer ${rotated.body.data.accessToken}`)).status,
      401,
      "the session is gone"
    );
  });

  test("walk-in: staff create the customer at the desk, who later self-serves", async () => {
    // The second creation path. Someone walks into the office, staff enter them
    // on the desktop app, and they may later use the portal from their phone.
    const phone = "+2348133000003";
    await db.delete(customerOtps);
    const stale = await customerRepo.findByPhone(phone);
    if (stale) await customerRepo.deleteById(stale.id);

    await ensureTestStaff();
    const staff = (
      await request(app)
        .post("/api/auth/login")
        .send({ email: TEST_STAFF.email, password: TEST_STAFF.password })
    ).body.data;

    // 1. Staff create them at the desk.
    const created = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ name: "Walk In Buyer", phone: "0813 300 0003", companyName: "Desk Co" });

    assert.equal(created.status, 201, "staff can create a customer");
    const row = await customerRepo.findByPhone(phone);
    assert.ok(row, "stored under the normalised E.164 number, not as typed");
    assert.equal(
      row.status,
      "Active",
      "staff met them in person — that vouching is the vetting, so no OTP gate applies"
    );
    assert.equal(row.phoneVerifiedAt, null, "but the number itself is still unproven");

    // 2. Staff creation is idempotent-safe: the same number cannot be entered twice.
    const duplicate = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ name: "Walk In Buyer Again", phone });
    assert.equal(duplicate.status, 409, "duplicate phone is refused");

    // 3. Later, they use the portal. They already exist, so this is a LOGIN —
    //    register is not involved and would not have been correct.
    await request(app).post(`${PORTAL}/request-otp`).send({ phone });
    const verified = await request(app)
      .post(`${PORTAL}/verify-otp`)
      .send({ phone, code: DEV_CODE });

    assert.equal(verified.status, 200, "a staff-created customer can sign in to the portal");
    assert.equal(verified.body.data.customer.status, "Active", "still Active");
    assert.ok(
      verified.body.data.customer.phoneVerifiedAt,
      "and the number is now proven as well"
    );
    assert.equal(verified.body.data.customer.name, "Walk In Buyer", "same record, not a new one");

    // 4. One customer, not two. Queried directly rather than through findAll,
    //    which clamps limit to 100 and could miss the row entirely.
    const matches = await db.select().from(customers).where(eq(customers.phone, phone));
    assert.equal(matches.length, 1, "the two creation paths must not fork the identity");
  });

  test("the two realms stay separated across a whole journey", async () => {
    await ensureTestStaff();
    const staff = (
      await request(app)
        .post("/api/auth/login")
        .send({ email: TEST_STAFF.email, password: TEST_STAFF.password })
    ).body.data;

    const phone = "+2348133000002";
    await db.delete(customerOtps);
    await request(app).post(`${PORTAL}/register`).send({ phone, name: "Realm Test" });
    const customer = (
      await request(app).post(`${PORTAL}/verify-otp`).send({ phone, code: DEV_CODE })
    ).body.data;

    // Access tokens do not cross.
    assert.equal(
      (await request(app).get(`${PORTAL}/me`).set("Authorization", `Bearer ${staff.accessToken}`))
        .status,
      401,
      "a staff token cannot read the portal"
    );
    assert.equal(
      (await request(app).get("/api/auth/me").set("Authorization", `Bearer ${customer.accessToken}`))
        .status,
      403,
      "a customer token cannot read the dashboard"
    );

    // Refresh tokens do not cross either — the hash is domain-separated, so
    // the customer's token simply does not exist in the staff realm.
    assert.equal(
      (await request(app).post("/api/auth/refresh").send({ refreshToken: customer.refreshToken }))
        .status,
      403,
      "a customer refresh token is unknown to the staff realm"
    );
    assert.equal(
      (await request(app).post(`${PORTAL}/refresh`).send({ refreshToken: staff.refreshToken }))
        .status,
      401,
      "and the reverse"
    );
  });
});
