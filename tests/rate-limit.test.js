// Must precede any require that reaches config/db.
require("dotenv").config();

// The suite runs with RATE_LIMIT_DISABLED=true so that login-heavy tests are
// not derailed by 429s. This file is the exception: it exists to prove the
// limiter still works, so it switches it back on. node:test gives each file its
// own process, so the limiter's in-memory counters start clean here and cannot
// leak into another file.
process.env.RATE_LIMIT_DISABLED = "false";

const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { closeDb } = require("./helpers");

describe("rate limiting is active on the auth surface", () => {
  after(async () => {
    await closeDb();
  });

  test("repeated failed logins are throttled", async () => {
    const attempt = () =>
      request(app)
        .post("/api/auth/login")
        .send({ email: "nobody@soroman.test", password: "wrong" });

    const statuses = [];
    for (let i = 0; i < 8; i++) {
      statuses.push((await attempt()).status);
    }

    // The limiter allows 5 per minute, so the tail must be throttled.
    assert.ok(statuses.includes(401), "early attempts are answered normally");
    assert.ok(statuses.includes(429), "later attempts are throttled");
    assert.equal(statuses.at(-1), 429, "throttling persists within the window");
  });

  test("the throttled response keeps the standard envelope", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@soroman.test", password: "wrong" });

    assert.equal(res.status, 429);
    assert.equal(res.body.success, false);
    assert.ok(typeof res.body.message === "string" && res.body.message.length > 0);
  });
});
