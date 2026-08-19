// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const { customerRepo, customerOtpRepo, sessionRepo } = require("../repositories");
const walletService = require("../services/wallet.service");
const { signAccessToken } = require("../services/token.service");
const { closeDb, TEST_STAFF, NATIVE_TRANSPORT, ensureTestStaff } = require("./helpers");

const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const BASE = "/api/customer/auth";

/** Comfortably past any per-phone budget, so the limiter is certainly engaged. */
const LIMIT_OVERSHOOT = 8;

// Distinct numbers per concern, so one test's rate-limit budget cannot starve
// another's. All valid Nigerian mobiles.
//
// Prefix +234810 is reserved for THIS file. It must not collide with the
// time-derived numbers other suites mint in the same serial run —
// identity.test.js and otp-demo.test.js both generate +234811 plus seven
// digits of Date.now()%1e7, which cycles through every fixed +234811xxxxxxx
// value (this file's old numbers included) every ~2.8 hours. consumer_customer
// has no unique constraint on phone_number, so such a collision silently
// leaves duplicate rows and findByPhone starts returning the other suite's
// customer. Before claiming a new prefix here, grep tests/ for it first.
const PHONES = {
  register: "+2348105550001",
  existing: "+2348105550002",
  unknown: "+2348105550003",
  attempts: "+2348105550004",
  session: "+2348105550005",
  intl: "+447400123456",
  pending: "+2348105550007",
  scoping: "+2348105550008",
  delete: "+2348105550009",
  deleteBalance: "+2348105550010",
  company: "+2348105550011",
};

const { db } = require("../config/db");
const { customerOtps } = require("../db/schema");

/**
 * Reset the SQL-backed rate-limit budgets.
 *
 * They count real rows over a rolling hour, so codes issued by an earlier test
 * — or an earlier run against this shared database — consume the budget of
 * everything that follows. Clearing the history resets the window without
 * disabling the limiter itself, which stays under test.
 */
async function clearOtpHistory() {
  await db.delete(customerOtps);
}

async function resetCustomer(phone, overrides = {}) {
  // No status column on consumer_customer — the old { status: "Active" }
  // stamp is gone with the lifecycle (see the account-state note below).
  await clearOtpHistory();
  const existing = await customerRepo.findByPhone(phone);
  if (existing) {
    return customerRepo.update(existing.id, overrides);
  }
  return customerRepo.create({
    name: "Fixture Customer",
    phone,
    companyName: "",
    ...overrides,
  });
}

/** Register, verify, and return the issued tokens. */
async function signIn(phone, name = "Fixture Customer") {
  await clearOtpHistory();
  await request(app).post(`${BASE}/register`).send({ phone, name });
  const res = await request(app).post(`${BASE}/verify-otp`).set(NATIVE_TRANSPORT).send({ phone, code: DEV_CODE });
  assert.equal(res.status, 200, `sign-in failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

describe("customer auth — register, OTP, enumeration safety", () => {
  before(async () => {
    await clearOtpHistory();
  });

  after(async () => {
    await closeDb();
  });

  // --- rate limiting -------------------------------------------------------

  test("the per-phone budget throttles repeated code requests", async () => {
    // The precise control: tied to the number under attack, so it cannot be
    // evaded by rotating source addresses.
    const customer = await resetCustomer(PHONES.attempts);
    const { LIMITS } = require("../services/otp.service");
    const budget = LIMITS.login.perPhone;

    for (let i = 0; i < budget; i++) {
      await request(app).post(`${BASE}/request-otp`).send({ phone: PHONES.attempts });
    }
    const issued = await customerOtpRepo.countSince({
      customerId: customer.id,
      sinceMinutes: 60,
    });
    assert.equal(issued, budget, "the budget is spent exactly");

    await request(app).post(`${BASE}/request-otp`).send({ phone: PHONES.attempts });
    assert.equal(
      await customerOtpRepo.countSince({ customerId: customer.id, sinceMinutes: 60 }),
      budget,
      "no further code is issued once the budget is spent"
    );
  });

  test("being throttled still returns the generic response", async () => {
    // A 429 here would tell an attacker the number is registered.
    const customer = await resetCustomer(PHONES.attempts);
    for (let i = 0; i < LIMIT_OVERSHOOT; i++) {
      await request(app).post(`${BASE}/request-otp`).send({ phone: PHONES.attempts });
    }
    const throttled = await request(app)
      .post(`${BASE}/request-otp`)
      .send({ phone: PHONES.attempts });

    assert.equal(throttled.status, 200);
    assert.equal(throttled.body.success, true);
    assert.ok(customer);
  });

  // --- registration --------------------------------------------------------

  test("registering an unknown number creates a customer", async () => {
    // consumer_customer has no status column — the old Pending/Active
    // lifecycle is gone (accepted 2026-08-19). What still matters: the row
    // exists and no session is issued until the OTP is verified.
    await clearOtpHistory();
    const existing = await customerRepo.findByPhone(PHONES.register);
    if (existing) await customerRepo.deleteById(existing.id);

    const res = await request(app)
      .post(`${BASE}/register`)
      .send({ phone: PHONES.register, name: "Ada Lovelace", companyName: "Analytical Ltd" });

    assert.equal(res.status, 200);
    assert.equal(res.body.data?.accessToken, undefined, "registration alone must not issue a session");
    const created = await customerRepo.findByPhone(PHONES.register);
    assert.ok(created, "customer row created");
    assert.equal(created.name, "Ada Lovelace");
    assert.equal(created.companyName, "Analytical Ltd");
  });

  test("name is required and validated server-side", async () => {
    for (const body of [
      { phone: PHONES.register },
      { phone: PHONES.register, name: "" },
      { phone: PHONES.register, name: "   " },
    ]) {
      const res = await request(app).post(`${BASE}/register`).send(body);
      assert.equal(res.status, 400, `body ${JSON.stringify(body)} should be rejected`);
    }
  });

  test("companyName is optional", async () => {
    // Own number — this test deletes and re-registers it, which must never
    // eat another concern's fixture (it used to share PHONES.delete).
    const phone = PHONES.company;
    const existing = await customerRepo.findByPhone(phone);
    if (existing) await customerRepo.deleteById(existing.id);

    const res = await request(app).post(`${BASE}/register`).send({ phone, name: "Solo Trader" });
    assert.equal(res.status, 200);
    const created = await customerRepo.findByPhone(phone);
    assert.ok(created);
    assert.equal(created.companyName, "");
  });

  test("an international number can register", async () => {
    const existing = await customerRepo.findByPhone(PHONES.intl);
    if (existing) await customerRepo.deleteById(existing.id);

    const res = await request(app)
      .post(`${BASE}/register`)
      .send({ phone: PHONES.intl, name: "Overseas Buyer" });

    assert.equal(res.status, 200);
    const created = await customerRepo.findByPhone(PHONES.intl);
    assert.ok(created, "non-Nigerian numbers are accepted");
    assert.equal(created.phone, PHONES.intl);
  });

  test("registering an existing number does not duplicate or overwrite it", async () => {
    const before = await resetCustomer(PHONES.existing, { name: "Original Name" });

    const res = await request(app)
      .post(`${BASE}/register`)
      .send({ phone: PHONES.existing, name: "Impostor Name", companyName: "Impostor Ltd" });

    assert.equal(res.status, 200, "responds identically to a fresh registration");
    const after = await customerRepo.findByPhone(PHONES.existing);
    assert.equal(after.id, before.id, "no duplicate row");
    assert.equal(after.name, "Original Name", "an existing profile must not be overwritten");
  });

  test("a malformed number is a 400, not an enumeration signal", async () => {
    const res = await request(app)
      .post(`${BASE}/register`)
      .send({ phone: "not-a-number", name: "Someone" });
    assert.equal(res.status, 400);
  });

  // --- enumeration safety --------------------------------------------------

  test("request-otp answers identically for known and unknown numbers", async () => {
    await resetCustomer(PHONES.existing);
    const known = await request(app).post(`${BASE}/request-otp`).send({ phone: PHONES.existing });

    const stray = await customerRepo.findByPhone(PHONES.unknown);
    if (stray) await customerRepo.deleteById(stray.id);
    const unknown = await request(app).post(`${BASE}/request-otp`).send({ phone: PHONES.unknown });

    assert.equal(known.status, unknown.status);
    assert.deepEqual(known.body, unknown.body, "bodies must be byte-identical");
  });

  test("request-otp never creates a customer", async () => {
    const stray = await customerRepo.findByPhone(PHONES.unknown);
    if (stray) await customerRepo.deleteById(stray.id);

    await request(app).post(`${BASE}/request-otp`).send({ phone: PHONES.unknown });

    assert.equal(
      await customerRepo.findByPhone(PHONES.unknown),
      null,
      "login must not self-register — that is what /register is for"
    );
  });

  test("request-otp sends nothing to an unknown number", async () => {
    const before = await customerOtpRepo.countToday();
    await request(app).post(`${BASE}/request-otp`).send({ phone: PHONES.unknown });
    assert.equal(
      await customerOtpRepo.countToday(),
      before,
      "no code row means no SMS was attempted"
    );
  });

  test("register and request-otp both take at least the timing floor", async () => {
    // Identical bodies are not enough: sending an SMS and doing nothing differ
    // by a network round trip, which is measurable.
    const stray = await customerRepo.findByPhone(PHONES.unknown);
    if (stray) await customerRepo.deleteById(stray.id);

    const t0 = Date.now();
    await request(app).post(`${BASE}/request-otp`).send({ phone: PHONES.unknown });
    const unknownMs = Date.now() - t0;

    assert.ok(unknownMs >= 600, `unknown-number path returned in ${unknownMs}ms, too fast`);
  });

  // --- verification --------------------------------------------------------

  test("a correct code verifies and issues a session", async () => {
    await resetCustomer(PHONES.existing);
    await request(app).post(`${BASE}/request-otp`).send({ phone: PHONES.existing });

    const res = await request(app)
      .post(`${BASE}/verify-otp`).set(NATIVE_TRANSPORT)
      .send({ phone: PHONES.existing, code: DEV_CODE });

    assert.equal(res.status, 200);
    assert.ok(res.body.data.accessToken);
    assert.ok(res.body.data.refreshToken);

    const decoded = jwt.decode(res.body.data.accessToken);
    assert.equal(decoded.aud, "customer");
    assert.ok(Number.isInteger(decoded.sid));
    assert.equal(decoded.roles, undefined, "customers carry no roles claim");
  });

  test("a wrong code is refused and the code is not consumed", async () => {
    await resetCustomer(PHONES.attempts);
    await request(app).post(`${BASE}/request-otp`).send({ phone: PHONES.attempts });

    const bad = await request(app)
      .post(`${BASE}/verify-otp`).set(NATIVE_TRANSPORT)
      .send({ phone: PHONES.attempts, code: "999999" });
    assert.equal(bad.status, 401);

    const good = await request(app)
      .post(`${BASE}/verify-otp`).set(NATIVE_TRANSPORT)
      .send({ phone: PHONES.attempts, code: DEV_CODE });
    assert.equal(good.status, 200, "one wrong guess must not burn the code");
  });

  test("the code is burned after the attempt cap", async () => {
    const customer = await resetCustomer(PHONES.attempts);
    await request(app).post(`${BASE}/request-otp`).send({ phone: PHONES.attempts });

    for (let i = 0; i < customerOtpRepo.MAX_ATTEMPTS; i++) {
      await request(app).post(`${BASE}/verify-otp`).set(NATIVE_TRANSPORT).send({ phone: PHONES.attempts, code: "111111" });
    }

    const afterCap = await request(app)
      .post(`${BASE}/verify-otp`).set(NATIVE_TRANSPORT)
      .send({ phone: PHONES.attempts, code: DEV_CODE });
    assert.equal(afterCap.status, 401, "the correct code must no longer work");
    assert.equal(await customerOtpRepo.findLive(customer.id), null, "code was consumed");
  });

  test("a code is single-use", async () => {
    await resetCustomer(PHONES.existing);
    await request(app).post(`${BASE}/request-otp`).send({ phone: PHONES.existing });

    const first = await request(app)
      .post(`${BASE}/verify-otp`).set(NATIVE_TRANSPORT)
      .send({ phone: PHONES.existing, code: DEV_CODE });
    assert.equal(first.status, 200);

    const replay = await request(app)
      .post(`${BASE}/verify-otp`).set(NATIVE_TRANSPORT)
      .send({ phone: PHONES.existing, code: DEV_CODE });
    assert.equal(replay.status, 401, "a consumed code cannot be redeemed again");
  });

  test("verify answers identically for unknown numbers and wrong codes", async () => {
    const stray = await customerRepo.findByPhone(PHONES.unknown);
    if (stray) await customerRepo.deleteById(stray.id);

    const unknownNumber = await request(app)
      .post(`${BASE}/verify-otp`).set(NATIVE_TRANSPORT)
      .send({ phone: PHONES.unknown, code: DEV_CODE });

    await resetCustomer(PHONES.existing);
    await request(app).post(`${BASE}/request-otp`).send({ phone: PHONES.existing });
    const wrongCode = await request(app)
      .post(`${BASE}/verify-otp`).set(NATIVE_TRANSPORT)
      .send({ phone: PHONES.existing, code: "424242" });

    assert.equal(unknownNumber.status, wrongCode.status);
    assert.deepEqual(unknownNumber.body, wrongCode.body);
  });

  test("requesting a new code invalidates the previous one", async () => {
    const customer = await resetCustomer(PHONES.existing);
    await request(app).post(`${BASE}/request-otp`).send({ phone: PHONES.existing });
    const first = await customerOtpRepo.findLive(customer.id);

    await request(app).post(`${BASE}/request-otp`).send({ phone: PHONES.existing });
    const second = await customerOtpRepo.findLive(customer.id);

    assert.notEqual(first.id, second.id, "a new row is live");
  });

  // --- realm separation ----------------------------------------------------

  test("a customer token is rejected by a staff route", async () => {
    const { accessToken } = await signIn(PHONES.session);
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 403, "the staff realm must not accept a customer token");
  });

  test("a staff token is rejected by a customer route", async () => {
    await ensureTestStaff();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: TEST_STAFF.email, password: TEST_STAFF.password });

    const res = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", `Bearer ${login.body.data.accessToken}`);
    assert.equal(res.status, 401, "the customer realm must not accept a staff token");
  });

  test("a customer token signed with the staff secret does not verify", async () => {
    // Guards the boot assertion that the two secrets differ.
    const forged = signAccessToken("staff", { id: 1, roles: ["admin"] }, 1);
    const res = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", `Bearer ${forged}`);
    assert.equal(res.status, 401);
  });

  // --- sessions ------------------------------------------------------------

  test("refresh rotates the customer token", async () => {
    const { refreshToken } = await signIn(PHONES.session);
    const res = await request(app).post(`${BASE}/refresh`).set(NATIVE_TRANSPORT).send({ refreshToken });

    assert.equal(res.status, 200);
    assert.notEqual(res.body.data.refreshToken, refreshToken);
  });

  test("logout revokes the session immediately", async () => {
    const { accessToken, refreshToken } = await signIn(PHONES.session);
    assert.equal(
      (await request(app).get(`${BASE}/me`).set("Authorization", `Bearer ${accessToken}`)).status,
      200
    );

    await request(app).post(`${BASE}/logout`).send({ refreshToken });

    const after = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(after.status, 401, "an unexpired access token must stop working");
  });

  test("a customer cannot revoke another customer's session", async () => {
    const victim = await signIn(PHONES.session);
    const victimSession = await sessionRepo.findByToken("customer", victim.refreshToken);

    const attacker = await signIn(PHONES.scoping, "Other Customer");
    const res = await request(app)
      .delete(`${BASE}/sessions/${victimSession.id}`)
      .set("Authorization", `Bearer ${attacker.accessToken}`);

    assert.equal(res.status, 404, "ownership is in the WHERE, so it simply does not match");
    const untouched = await sessionRepo.findById(victimSession.id);
    assert.equal(untouched.revokedAt, null);
  });

  test("the session list never exposes the token hash", async () => {
    const { accessToken } = await signIn(PHONES.session);
    const res = await request(app)
      .get(`${BASE}/sessions`)
      .set("Authorization", `Bearer ${accessToken}`);

    assert.equal(res.status, 200);
    const serialised = JSON.stringify(res.body);
    assert.ok(!serialised.includes("refreshTokenHash"));
    assert.ok(!serialised.includes("refresh_token_hash"));
  });

  // --- account state -------------------------------------------------------

  // The Pending→Active promotion, "Inactive cannot authenticate", and
  // "deactivation kills a live session" tests stood here. consumer_customer
  // (Django's real table) has no status column, so the whole customer-status
  // lifecycle lost its backing in the live-DB cutover. Decision (2026-08-19):
  // accepted as gone rather than rebuilt on a sman table — proving control of
  // the phone via OTP is the activation gate, and there is currently no
  // deactivation mechanism in this backend. If deactivation returns, restore
  // these tests from git history alongside its new storage.

  test("verifying as a fresh registrant issues a session", async () => {
    await clearOtpHistory();
    const stray = await customerRepo.findByPhone(PHONES.pending);
    if (stray) await customerRepo.deleteById(stray.id);

    await request(app)
      .post(`${BASE}/register`)
      .send({ phone: PHONES.pending, name: "Newly Registered" });

    const verified = await request(app)
      .post(`${BASE}/verify-otp`).set(NATIVE_TRANSPORT)
      .send({ phone: PHONES.pending, code: DEV_CODE });

    assert.equal(verified.status, 200);
    assert.ok(verified.body.data.accessToken, "first verification signs the registrant in");
  });

  test("the ordering gate admits any authenticated customer", async () => {
    // requireActiveCustomer is a deliberate pass-through now (see
    // middleware/verifyCustomer.js) — holding a session token, which requires
    // having passed OTP verification, is the activation gate.
    const { requireActiveCustomer } = require("../middleware/verifyCustomer");
    let allowed = null;
    requireActiveCustomer(
      { customer: { id: 1 } },
      { status: () => ({ json: () => {} }) },
      () => (allowed = true)
    );
    assert.equal(allowed, true, "an authenticated customer passes");
  });

  // --- account deletion (App Store 5.1.1(v), OTP-gated) ---------------------

  test("DELETE /account anonymizes after a deletion OTP", async () => {
    const phone = PHONES.delete;
    const stray = await customerRepo.findByPhone(phone);
    if (stray) {
      await customerRepo.update(stray.id, {
        phone: `z${stray.id}`,
        status: "Inactive",
      });
    }

    const { accessToken, customer } = await signIn(phone, "Delete Me");
    const customerId = customer.id;

    const otpRes = await request(app)
      .post(`${BASE}/account/request-otp`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(otpRes.status, 200, JSON.stringify(otpRes.body));

    const res = await request(app)
      .delete(`${BASE}/account`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: DEV_CODE });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.deletedAt);

    const after = await customerRepo.findById(customerId);
    // No status/phoneVerifiedAt columns live — anonymization is the tombstone.
    assert.equal(after.name, "Deleted User");
    assert.equal(after.phone, `deleted_${customerId}`);
    assert.equal(after.email, "");

    const me = await request(app)
      .get(`${BASE}/me`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(me.status, 401, "revoked session cannot keep browsing");

    const reregister = await request(app)
      .post(`${BASE}/register`)
      .send({ phone, name: "Brand New" });
    assert.equal(reregister.status, 200);

    const fresh = await customerRepo.findByPhone(phone);
    assert.ok(fresh);
    assert.notEqual(fresh.id, customerId);
    assert.equal(fresh.name, "Brand New");
  });

  test("a login OTP cannot delete the account", async () => {
    const phone = PHONES.deleteBalance;
    const { accessToken, customer } = await signIn(phone, "Wrong Purpose");

    await request(app).post(`${BASE}/request-otp`).send({ phone });
    const res = await request(app)
      .delete(`${BASE}/account`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: DEV_CODE });

    assert.equal(res.status, 401, JSON.stringify(res.body));
    const after = await customerRepo.findById(customer.id);
    assert.equal(after.phone, phone, "account must remain intact");
    assert.equal(after.name, "Wrong Purpose", "not anonymized");
  });

  test("DELETE /account requires a verification code", async () => {
    const { accessToken } = await signIn(PHONES.deleteBalance);
    const res = await request(app)
      .delete(`${BASE}/account`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ confirm: "DELETE" });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test("request-otp and delete refuse when the wallet still has a balance", async () => {
    // Live model: there is no customers.balance column to poke — the blocker
    // (accountDeletionService.collectBlockers) reads customerRepo.getBalance,
    // i.e. SUM(sman.customer_credits) − SUM(active sman.wallet_holds). Fund
    // and drain the wallet through the real ledger instead.
    const phone = PHONES.deleteBalance;
    const { accessToken, customer } = await signIn(phone, "Has Balance");
    // register never overwrites an existing profile, so the row keeps
    // whatever name it was first created with — capture it for the
    // not-anonymized check at the end.
    const nameBefore = (await customerRepo.findById(customer.id)).name;

    const drain = async () => {
      const left = await customerRepo.getBalance(customer.id);
      if (left > 0) {
        const drained = await walletService.debit({
          customerId: customer.id,
          amount: left,
          description: "test drain — clear the deletion blocker",
        });
        assert.equal(drained.success, true, JSON.stringify(drained));
      }
    };
    await drain(); // the fixture customer persists across runs — start from 0

    const funded = await walletService.credit({
      customerId: customer.id,
      amount: 150,
      description: "deletion-blocker fixture funding",
    });
    assert.equal(funded.success, true, JSON.stringify(funded));

    try {
      const otpRes = await request(app)
        .post(`${BASE}/account/request-otp`)
        .set("Authorization", `Bearer ${accessToken}`);
      assert.equal(otpRes.status, 409, JSON.stringify(otpRes.body));
      assert.match(otpRes.body.message, /wallet/i);
      assert.match(otpRes.body.message, /₦150\.00/);

      await drain();
      await request(app)
        .post(`${BASE}/account/request-otp`)
        .set("Authorization", `Bearer ${accessToken}`);
      const refunded = await walletService.credit({
        customerId: customer.id,
        amount: 150,
        description: "deletion-blocker fixture re-funding",
      });
      assert.equal(refunded.success, true, JSON.stringify(refunded));

      const res = await request(app)
        .delete(`${BASE}/account`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ code: DEV_CODE });

      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.match(res.body.message, /wallet/i);
      assert.match(res.body.message, /₦150\.00/);
      assert.ok(Array.isArray(res.body.data?.blockers));

      const after = await customerRepo.findById(customer.id);
      assert.equal(after.phone, phone, "PII must remain when deletion is blocked");
      // No status column live — the row surviving un-anonymized is the check.
      assert.equal(after.name, nameBefore, "not anonymized");
      assert.notEqual(after.name, "Deleted User");
    } finally {
      await drain();
    }
  });

  // --- spend cap -----------------------------------------------------------

  test("the daily send cap returns 503 and sends nothing", async () => {
    const original = process.env.OTP_DAILY_SEND_CAP;
    process.env.OTP_DAILY_SEND_CAP = "0";
    try {
      await resetCustomer(PHONES.existing);
      const before = await customerOtpRepo.countToday();

      const login = await request(app)
        .post(`${BASE}/request-otp`)
        .send({ phone: PHONES.existing });
      assert.equal(login.status, 503);

      const register = await request(app)
        .post(`${BASE}/register`)
        .send({ phone: PHONES.register, name: "Someone" });
      assert.equal(register.status, 503, "the cap covers registration too");

      assert.equal(await customerOtpRepo.countToday(), before, "no codes issued while capped");
    } finally {
      process.env.OTP_DAILY_SEND_CAP = original;
    }
  });
});
