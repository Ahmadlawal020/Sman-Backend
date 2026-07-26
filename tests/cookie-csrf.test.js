// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { CSRF_COOKIE, COOKIES } = require("../services/cookie.service");
const { timingSafeEqualStrings } = require("../middleware/csrf");
const { TEST_STAFF, ensureTestStaff, closeDb } = require("./helpers");

const STAFF_COOKIE = COOKIES.staff.name;

const login = (headers = {}) => {
  const req = request(app).post("/api/auth/login");
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  return req.send({ email: TEST_STAFF.email, password: TEST_STAFF.password });
};

/** Parse Set-Cookie into { name: {value, attrs} }. */
function parseCookies(res) {
  const raw = res.headers["set-cookie"] || [];
  const out = {};
  for (const line of raw) {
    const [pair, ...rest] = line.split(";");
    const idx = pair.indexOf("=");
    const name = pair.slice(0, idx).trim();
    out[name] = {
      value: pair.slice(idx + 1).trim(),
      attrs: rest.map((a) => a.trim().toLowerCase()),
    };
  }
  return out;
}

const cookieHeader = (pairs) =>
  Object.entries(pairs)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

describe("cookie transport and CSRF", () => {
  before(async () => {
    await ensureTestStaff();
  });

  after(async () => {
    await closeDb();
  });

  // --- cookie attributes ---------------------------------------------------

  test("login sets an httpOnly refresh cookie", async () => {
    const res = await login();
    const cookies = parseCookies(res);

    const refresh = cookies[STAFF_COOKIE];
    assert.ok(refresh, "refresh cookie is set");
    assert.ok(
      refresh.attrs.includes("httponly"),
      "httpOnly is the entire point — without it XSS can read the token"
    );
    assert.ok(refresh.attrs.some((a) => a.startsWith("samesite=")));
  });

  test("the refresh cookie is path-scoped to its own realm", async () => {
    const cookies = parseCookies(await login());
    const refresh = cookies[STAFF_COOKIE];

    assert.ok(
      refresh.attrs.includes("path=/api/auth"),
      "a staff cookie must never be transmitted to /api/customer/auth"
    );
    assert.notEqual(COOKIES.staff.name, COOKIES.customer.name, "realms use distinct names");
    assert.notEqual(COOKIES.staff.path, COOKIES.customer.path, "and distinct paths");
  });

  test("the CSRF cookie is readable by JavaScript, unlike the refresh cookie", async () => {
    const cookies = parseCookies(await login());
    const csrf = cookies[CSRF_COOKIE];

    assert.ok(csrf, "CSRF cookie is set alongside");
    assert.ok(
      !csrf.attrs.includes("httponly"),
      "the client has to read it to echo it back — that is the double-submit mechanism"
    );
  });

  test("the CSRF token is unpredictable", async () => {
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
      seen.add(parseCookies(await login())[CSRF_COOKIE].value);
    }
    assert.equal(seen.size, 5, "a fresh token per issue");
  });

  // --- hybrid transport ----------------------------------------------------

  test("the body token is returned by default, so existing clients keep working", async () => {
    const res = await login();
    assert.ok(res.body.data.refreshToken, "default transport is non-breaking");
  });

  test("a client can opt into cookie-only and the body token disappears", async () => {
    const res = await login({ "X-Auth-Transport": "cookie" });

    assert.equal(
      res.body.data.refreshToken,
      undefined,
      "cookie-only clients must not also receive it where XSS can read it"
    );
    assert.ok(res.body.data.accessToken, "the access token still comes back in the body");
    assert.ok(parseCookies(res)[STAFF_COOKIE], "and the cookie is still set");
  });

  test("transport mode is recorded, so the body path can be proven dead", async () => {
    // "Delete the body-token path once the dashboard migrates" is a condition
    // nobody can prove is met. Counting makes it provable.
    const { getTransportCounts } = require("../services/cookie.service");
    const before = getTransportCounts();

    await login();
    await login({ "X-Auth-Transport": "cookie" });

    const after = getTransportCounts();
    assert.equal(after.staff.body, before.staff.body + 1, "body issuance counted");
    assert.equal(after.staff.cookie, before.staff.cookie + 1, "cookie issuance counted");
    assert.equal(after.customer.body, before.customer.body, "realms are counted separately");
  });

  // --- refresh via cookie --------------------------------------------------

  test("refresh works from the cookie with a matching CSRF header", async () => {
    const res = await login({ "X-Auth-Transport": "cookie" });
    const cookies = parseCookies(res);
    const csrf = cookies[CSRF_COOKIE].value;

    const refreshed = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookieHeader({
        [STAFF_COOKIE]: cookies[STAFF_COOKIE].value,
        [CSRF_COOKIE]: csrf,
      }))
      .set("X-CSRF-Token", csrf)
      .send({});

    assert.equal(refreshed.status, 200);
    assert.ok(parseCookies(refreshed)[STAFF_COOKIE], "a rotated cookie is issued");
  });

  test("refresh from a cookie without the CSRF header is refused", async () => {
    // This is the attack: a cross-site POST carries the cookie automatically
    // but cannot carry a header whose value the attacker cannot read.
    const cookies = parseCookies(await login({ "X-Auth-Transport": "cookie" }));

    const res = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookieHeader({
        [STAFF_COOKIE]: cookies[STAFF_COOKIE].value,
        [CSRF_COOKIE]: cookies[CSRF_COOKIE].value,
      }))
      .send({});

    assert.equal(res.status, 403);
    assert.match(res.body.message, /csrf/i);
  });

  test("a mismatched CSRF header is refused", async () => {
    const cookies = parseCookies(await login({ "X-Auth-Transport": "cookie" }));

    const res = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookieHeader({
        [STAFF_COOKIE]: cookies[STAFF_COOKIE].value,
        [CSRF_COOKIE]: cookies[CSRF_COOKIE].value,
      }))
      .set("X-CSRF-Token", "a-token-the-attacker-guessed")
      .send({});

    assert.equal(res.status, 403);
  });

  test("a CSRF header with no CSRF cookie is refused", async () => {
    const cookies = parseCookies(await login({ "X-Auth-Transport": "cookie" }));

    const res = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookieHeader({ [STAFF_COOKIE]: cookies[STAFF_COOKIE].value }))
      .set("X-CSRF-Token", "anything")
      .send({});

    assert.equal(res.status, 403);
  });

  // --- body transport is unaffected ---------------------------------------

  test("a body-borne refresh token needs no CSRF header", async () => {
    // Native clients do not use cookies, and an attacker who could supply the
    // token would not need CSRF — demanding a header here would break them for
    // no security gain.
    const { body } = await login();

    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: body.data.refreshToken });

    assert.equal(res.status, 200);
  });

  test("a body token wins over a stale cookie", async () => {
    const stale = parseCookies(await login({ "X-Auth-Transport": "cookie" }));
    const fresh = await login();

    const res = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookieHeader({ [STAFF_COOKIE]: stale[STAFF_COOKIE].value }))
      .send({ refreshToken: fresh.body.data.refreshToken });

    assert.equal(res.status, 200, "the explicitly supplied token is the one used");
  });

  // --- logout --------------------------------------------------------------

  test("logout clears both cookies", async () => {
    const cookies = parseCookies(await login({ "X-Auth-Transport": "cookie" }));
    const csrf = cookies[CSRF_COOKIE].value;

    const res = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookieHeader({
        [STAFF_COOKIE]: cookies[STAFF_COOKIE].value,
        [CSRF_COOKIE]: csrf,
      }))
      .set("X-CSRF-Token", csrf)
      .send({});

    const cleared = parseCookies(res);
    assert.ok(cleared[STAFF_COOKIE], "refresh cookie is overwritten");
    assert.equal(cleared[STAFF_COOKIE].value, "", "with an empty value");
    assert.ok(cleared[CSRF_COOKIE], "csrf cookie is cleared too");
  });

  test("a failed refresh clears the cookie rather than leaving it stale", async () => {
    const { sessionRepo } = require("../repositories");
    const bogus = sessionRepo.generateToken();

    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: bogus });

    assert.equal(res.status, 403);
    const cleared = parseCookies(res);
    assert.equal(cleared[STAFF_COOKIE]?.value, "");
  });

  // --- comparison primitive ------------------------------------------------

  test("token comparison is length-safe and correct", () => {
    assert.equal(timingSafeEqualStrings("abc", "abc"), true);
    assert.equal(timingSafeEqualStrings("abc", "abd"), false);
    // timingSafeEqual throws on differing lengths, which would leak length via
    // a 500 instead of returning false.
    assert.equal(timingSafeEqualStrings("abc", "abcd"), false);
    assert.equal(timingSafeEqualStrings("", ""), true);
  });
});
