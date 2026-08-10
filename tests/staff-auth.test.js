// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../app");
const { sessionRepo, staffRepo } = require("../repositories");
const sessionService = require("../services/session.service");
const { signAccessToken, verifyAccessToken, TokenError } = require("../services/token.service");
const { secretFor, ISSUER } = require("../config/auth");
const { TEST_STAFF, NATIVE_TRANSPORT, ensureTestStaff, staffTokenWithRoles, closeDb } = require("./helpers");

/**
 * Most of this suite needs to hold a refresh token, which only the native
 * transport returns in the body. Browsers get an httpOnly cookie instead —
 * that path is covered in cookie-csrf.test.js.
 *
 * Re-asserts the fixture on every call rather than trusting the `before` hook.
 * Several tests here deliberately deactivate or suspend this row and restore
 * it afterwards, and the suite runs against a shared database, so ambient
 * state is not something to rely on: a login that silently returned 401 showed
 * up as `body.data` being undefined several assertions later, which is a
 * miserable thing to debug.
 */
const login = async () => {
  await ensureTestStaff();
  return request(app)
    .post("/api/auth/login")
    .set(NATIVE_TRANSPORT)
    .send({ email: TEST_STAFF.email, password: TEST_STAFF.password });
};

describe("staff auth — opaque refresh tokens, rotation, reuse detection", () => {
  let staffRow;

  before(async () => {
    staffRow = await ensureTestStaff();
  });

  after(async () => {
    await closeDb();
  });

  // --- token shape ---------------------------------------------------------

  test("an access token carries sub, aud, iss and sid", async () => {
    const res = await login();
    assert.equal(res.status, 200);

    const decoded = jwt.decode(res.body.data.accessToken);
    assert.equal(decoded.aud, "staff");
    assert.equal(decoded.iss, ISSUER);
    assert.equal(Number(decoded.sub), staffRow.id);
    assert.ok(Number.isInteger(decoded.sid), "token is bound to a session");
  });

  test("the refresh token is opaque, not a JWT", async () => {
    const res = await login();
    const refresh = res.body.data.refreshToken;

    assert.equal(jwt.decode(refresh), null, "must not decode as a JWT");
    assert.match(refresh, /^[A-Za-z0-9_-]{43}$/, "32 bytes of base64url");
  });

  test("the database stores only the hash, never the token", async () => {
    const res = await login();
    const refresh = res.body.data.refreshToken;

    const session = await sessionRepo.findByToken("staff", refresh);
    assert.ok(session);
    assert.equal(session.refreshTokenHash, sessionRepo.hashToken("staff", refresh));
    assert.ok(
      !JSON.stringify(session).includes(refresh),
      "the plaintext must not appear anywhere on the row"
    );
  });

  test("a token signed for the customer realm is rejected by a staff route", async () => {
    // The audience claim is what stops one realm's token working in the other.
    const customerToken = signAccessToken("customer", { id: staffRow.id }, 1);
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${customerToken}`);
    assert.equal(res.status, 403);
  });

  test("an unsigned (alg:none) token is rejected", () => {
    // Pinning algorithms is what prevents this; without it the header dictates
    // verification and `none` bypasses it entirely.
    const forged = [
      Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ sub: "1", aud: "staff", iss: ISSUER, sid: 1 })).toString("base64url"),
      "",
    ].join(".");

    assert.throws(() => verifyAccessToken("staff", forged), TokenError);
  });

  test("a token with a valid signature but no sid is rejected", () => {
    // Guards the per-request session check: a token that is not bound to a
    // session cannot be revoked, so it must not be accepted at all.
    const noSid = jwt.sign({ email: "x@y.z" }, secretFor("staff"), {
      algorithm: "HS256",
      issuer: ISSUER,
      audience: "staff",
      subject: "1",
      expiresIn: "5m",
    });
    assert.throws(() => verifyAccessToken("staff", noSid), TokenError);
  });

  // --- rotation ------------------------------------------------------------

  test("refreshing rotates the token and invalidates the old one", async () => {
    const { body } = await login();
    const first = body.data.refreshToken;

    const rotated = await request(app).post("/api/auth/refresh").set(NATIVE_TRANSPORT).send({ refreshToken: first });
    assert.equal(rotated.status, 200);

    const second = rotated.body.data.refreshToken;
    assert.notEqual(second, first, "a new token is issued");

    const oldSession = await sessionRepo.findByToken("staff", first);
    assert.equal(oldSession.revokedReason, "rotated");
    assert.ok(oldSession.replacedById, "lineage is recorded");
  });

  test("the rotated successor works", async () => {
    const { body } = await login();
    const rotated = await request(app)
      .post("/api/auth/refresh").set(NATIVE_TRANSPORT)
      .send({ refreshToken: body.data.refreshToken });

    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${rotated.body.data.accessToken}`);
    assert.equal(me.status, 200);
  });

  test("replaying a rotated token inside the grace window is not treated as theft", async () => {
    // A dropped response is indistinguishable from theft without this: the
    // client never saw the successor and retries with the old token.
    const { body } = await login();
    const first = body.data.refreshToken;

    const a = await request(app).post("/api/auth/refresh").set(NATIVE_TRANSPORT).send({ refreshToken: first });
    assert.equal(a.status, 200);

    const replay = await request(app).post("/api/auth/refresh").set(NATIVE_TRANSPORT).send({ refreshToken: first });
    assert.equal(replay.status, 200, "replay within grace is served, not punished");
    assert.notEqual(replay.body.data.refreshToken, a.body.data.refreshToken);
  });

  test("replaying a rotated token outside the grace window kills the family", async () => {
    const { body } = await login();
    const first = body.data.refreshToken;

    const a = await request(app).post("/api/auth/refresh").set(NATIVE_TRANSPORT).send({ refreshToken: first });
    const live = a.body.data.refreshToken;

    // Age the revocation past the grace window rather than sleeping for it.
    const stale = await sessionRepo.findByToken("staff", first);
    const { db } = require("../config/db");
    const { sessions } = require("../db/schema");
    const { eq, sql } = require("drizzle-orm");
    await db
      .update(sessions)
      .set({ revokedAt: sql`now() - interval '10 minutes'` })
      .where(eq(sessions.id, stale.id));

    // Capture the security log: detection nobody hears about is half a
    // mechanism, so the alert signal is part of the contract, not decoration.
    const originalError = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args.join(" "));

    let replay;
    try {
      replay = await request(app)
        .post("/api/auth/refresh")
        .set(NATIVE_TRANSPORT)
        .send({ refreshToken: first });
    } finally {
      console.error = originalError;
    }

    assert.equal(replay.status, 403, "reuse is rejected");

    const alert = logged.find((l) => l.includes("SESSION_REUSE_DETECTED"));
    assert.ok(alert, `no security alert emitted; saw: ${JSON.stringify(logged)}`);
    assert.match(alert, /realm=staff/);
    assert.match(alert, /sessions_revoked=[1-9]/, "reports how much was revoked");

    // The whole lineage goes: we cannot tell attacker from victim.
    const survivor = await sessionRepo.findByToken("staff", live);
    assert.equal(survivor.revokedReason, "reuse_detected");

    const stillWorks = await request(app)
      .post("/api/auth/refresh").set(NATIVE_TRANSPORT)
      .send({ refreshToken: live });
    assert.equal(stillWorks.status, 403, "the legitimate successor is revoked too");
  });

  test("a refresh token cannot be used twice concurrently", async () => {
    const { body } = await login();
    const token = body.data.refreshToken;

    const results = await Promise.all([
      request(app).post("/api/auth/refresh").set(NATIVE_TRANSPORT).send({ refreshToken: token }),
      request(app).post("/api/auth/refresh").set(NATIVE_TRANSPORT).send({ refreshToken: token }),
    ]);
    // Both may legitimately succeed (the second lands inside the grace window),
    // but they must never mint the same successor token.
    const tokens = results.filter((r) => r.status === 200).map((r) => r.body.data.refreshToken);
    assert.equal(new Set(tokens).size, tokens.length, "no two callers get the same token");
  });

  test("an unknown refresh token is refused", async () => {
    const res = await request(app)
      .post("/api/auth/refresh").set(NATIVE_TRANSPORT)
      .send({ refreshToken: sessionRepo.generateToken() });
    assert.equal(res.status, 403);
  });

  // --- revocation takes effect immediately ---------------------------------

  test("logout revokes the session and the access token stops working", async () => {
    const { body } = await login();
    const { accessToken, refreshToken } = body.data;

    assert.equal(
      (await request(app).get("/api/auth/me").set("Authorization", `Bearer ${accessToken}`)).status,
      200
    );

    await request(app).post("/api/auth/logout").send({ refreshToken });

    // The access token is still cryptographically valid and unexpired. Only the
    // per-request session check makes logout mean anything.
    const after = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(after.status, 401);
  });

  test("logout-all ends every session for the caller", async () => {
    const one = await login();
    const two = await login();

    const res = await request(app)
      .post("/api/auth/logout-all")
      .set("Authorization", `Bearer ${two.body.data.accessToken}`);
    assert.equal(res.status, 200);

    for (const session of [one, two]) {
      const check = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${session.body.data.accessToken}`);
      assert.equal(check.status, 401);
    }
  });

  test("suspending a staff member invalidates their live sessions immediately", async () => {
    const { body } = await login();
    const token = body.data.accessToken;

    await staffRepo.update(staffRow.id, { suspended: true });
    try {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 401, "a suspended account cannot keep using a live token");
    } finally {
      await staffRepo.update(staffRow.id, { suspended: false });
    }
  });

  test("a role revoked mid-session takes effect on the next request", async () => {
    // Roles are read from the row, not the token, precisely so this holds.
    //
    // Reads /api/tickets rather than /api/customers: under config/apiPermissions
    // finance is a legitimate customers reader (it is in MONEY), so that route
    // is no longer a privilege boundary and the downgrade would not show up.
    // Tickets is OPS+SECURITY+audit — admin in, finance out — so the assertion
    // still measures what it claims to.
    const { staff, accessToken } = await staffTokenWithRoles(["admin"]);
    assert.equal(
      (await request(app).get("/api/tickets").set("Authorization", `Bearer ${accessToken}`)).status,
      200
    );

    await staffRepo.update(staff.id, { roles: ["finance"] });
    const after = await request(app)
      .get("/api/tickets")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(after.status, 403, "the stale token must not carry stale privileges");
  });

  // --- session management --------------------------------------------------

  test("sessions are listable and never expose the token hash", async () => {
    const { body } = await login();
    const res = await request(app)
      .get("/api/auth/sessions")
      .set("Authorization", `Bearer ${body.data.accessToken}`);

    assert.equal(res.status, 200);
    assert.ok(res.body.data.sessions.length >= 1);
    const serialised = JSON.stringify(res.body);
    assert.ok(!serialised.includes("refreshTokenHash"), "no hash in the projection");
    assert.ok(!serialised.includes("refresh_token_hash"));
    assert.ok(
      res.body.data.sessions.some((s) => s.current === true),
      "the calling session is marked"
    );
  });

  test("one device can be revoked without ending the others", async () => {
    const keep = await login();
    const drop = await login();

    const dropSession = await sessionRepo.findByToken("staff", drop.body.data.refreshToken);
    const res = await request(app)
      .delete(`/api/auth/sessions/${dropSession.id}`)
      .set("Authorization", `Bearer ${keep.body.data.accessToken}`);
    assert.equal(res.status, 200);

    assert.equal(
      (await request(app).get("/api/auth/me").set("Authorization", `Bearer ${drop.body.data.accessToken}`)).status,
      401
    );
    assert.equal(
      (await request(app).get("/api/auth/me").set("Authorization", `Bearer ${keep.body.data.accessToken}`)).status,
      200
    );
  });

  test("a staff member cannot revoke a session they do not own", async () => {
    const victim = await login();
    const victimSession = await sessionRepo.findByToken("staff", victim.body.data.refreshToken);

    const { accessToken: otherToken } = await staffTokenWithRoles(
      ["admin"],
      "test-other-staff@soroman.test"
    );
    const res = await request(app)
      .delete(`/api/auth/sessions/${victimSession.id}`)
      .set("Authorization", `Bearer ${otherToken}`);

    assert.equal(res.status, 404, "ownership is in the WHERE, so it simply does not match");
    const untouched = await sessionRepo.findById(victimSession.id);
    assert.equal(untouched.revokedAt, null);
  });

  // --- credential changes --------------------------------------------------

  test("login still rejects bad credentials identically", async () => {
    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: TEST_STAFF.email, password: "definitely-wrong" });
    const unknownEmail = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@soroman.test", password: "definitely-wrong" });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.equal(wrongPassword.body.message, unknownEmail.body.message);
  });

  test("issuing a session for a suspended principal is refused on refresh", async () => {
    const { body } = await login();
    const refreshToken = body.data.refreshToken;

    await staffRepo.update(staffRow.id, { isActive: false });
    try {
      const res = await request(app).post("/api/auth/refresh").set(NATIVE_TRANSPORT).send({ refreshToken });
      assert.equal(res.status, 403);

      const session = await sessionRepo.findByToken("staff", refreshToken);
      assert.equal(session.revokedReason, "principal_deactivated");
    } finally {
      await staffRepo.update(staffRow.id, { isActive: true });
    }
  });
});
