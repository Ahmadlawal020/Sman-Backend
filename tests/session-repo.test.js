// Must precede any require that reaches config/db, which reads DATABASE_URL at
// module load. Explicit here rather than relying on require order via helpers.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { sessionRepo } = require("../repositories");
const { ensureTestStaff, ensureTestCustomer, closeDb } = require("./helpers");

const DAY = 24 * 60 * 60 * 1000;
const future = () => new Date(Date.now() + 7 * DAY);

describe("session.repository — realm discipline and atomic revoke", () => {
  let staffId;
  let customerId;

  before(async () => {
    staffId = (await ensureTestStaff()).id;
    customerId = (await ensureTestCustomer()).id;
  });

  after(async () => {
    await closeDb();
  });

  test("a missing or bogus realm throws instead of defaulting", () => {
    // Defaulting would silently query the wrong column — the exact failure the
    // exclusive arc exists to make impossible.
    for (const bad of [undefined, null, "", "admin", "Staff", "customers", 0]) {
      assert.throws(
        () => sessionRepo.assertRealm(bad),
        TypeError,
        `realm ${JSON.stringify(bad)} should throw`
      );
    }
    assert.doesNotThrow(() => sessionRepo.assertRealm("staff"));
    assert.doesNotThrow(() => sessionRepo.assertRealm("customer"));
  });

  test("the same token hashes differently per realm", () => {
    const token = sessionRepo.generateToken();
    const asStaff = sessionRepo.hashToken("staff", token);
    const asCustomer = sessionRepo.hashToken("customer", token);

    assert.notEqual(asStaff, asCustomer);
    assert.match(asStaff, /^[0-9a-f]{64}$/);
    assert.match(asCustomer, /^[0-9a-f]{64}$/);
  });

  test("hashToken rejects a non-string token", () => {
    assert.throws(() => sessionRepo.hashToken("staff", undefined), TypeError);
    assert.throws(() => sessionRepo.hashToken("staff", ""), TypeError);
  });

  test("generateToken is opaque and unpredictable", () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(sessionRepo.generateToken());
    assert.equal(seen.size, 200, "no collisions across 200 tokens");
    // base64url of 32 bytes — no padding, URL-safe alphabet only.
    assert.match(sessionRepo.generateToken(), /^[A-Za-z0-9_-]{43}$/);
  });

  test("a token minted for one realm does not resolve in the other", async () => {
    const token = sessionRepo.generateToken();
    await sessionRepo.create("staff", staffId, {
      token,
      familyId: crypto.randomUUID(),
      expiresAt: future(),
    });

    assert.ok(await sessionRepo.findByToken("staff", token), "found in its own realm");
    assert.equal(
      await sessionRepo.findByToken("customer", token),
      null,
      "the identical token string must not match across realms"
    );
  });

  test("create sets the arc column matching the realm and leaves the other null", async () => {
    const s = await sessionRepo.create("staff", staffId, {
      token: sessionRepo.generateToken(),
      familyId: crypto.randomUUID(),
      expiresAt: future(),
    });
    assert.equal(s.principalType, "staff");
    assert.equal(s.staffId, staffId);
    assert.equal(s.customerId, null);

    const c = await sessionRepo.create("customer", customerId, {
      token: sessionRepo.generateToken(),
      familyId: crypto.randomUUID(),
      expiresAt: future(),
    });
    assert.equal(c.principalType, "customer");
    assert.equal(c.customerId, customerId);
    assert.equal(c.staffId, null);
  });

  test("revokeById is atomic — exactly one of two concurrent callers wins", async () => {
    const s = await sessionRepo.create("customer", customerId, {
      token: sessionRepo.generateToken(),
      familyId: crypto.randomUUID(),
      expiresAt: future(),
    });

    // This is the primitive rotation is built on: the loser must be able to
    // tell it lost, which is how token reuse gets detected.
    const results = await Promise.all([
      sessionRepo.revokeById(s.id, "logout"),
      sessionRepo.revokeById(s.id, "logout"),
      sessionRepo.revokeById(s.id, "logout"),
    ]);
    const winners = results.filter(Boolean);
    assert.equal(winners.length, 1, "exactly one caller should get the row");
    assert.equal(winners[0].revokedReason, "logout");
  });

  test("findByToken still returns revoked and expired rows", async () => {
    // The caller must distinguish expired from reused; a repository that
    // filters these out cannot tell them apart.
    const token = sessionRepo.generateToken();
    const s = await sessionRepo.create("customer", customerId, {
      token,
      familyId: crypto.randomUUID(),
      expiresAt: future(),
    });
    await sessionRepo.revokeById(s.id, "rotated");

    const found = await sessionRepo.findByToken("customer", token);
    assert.ok(found, "revoked row is still findable");
    assert.ok(found.revokedAt);
  });

  test("listActive excludes revoked and expired sessions", async () => {
    const live = await sessionRepo.create("customer", customerId, {
      token: sessionRepo.generateToken(),
      familyId: crypto.randomUUID(),
      expiresAt: future(),
    });
    const revoked = await sessionRepo.create("customer", customerId, {
      token: sessionRepo.generateToken(),
      familyId: crypto.randomUUID(),
      expiresAt: future(),
    });
    await sessionRepo.revokeById(revoked.id, "logout");
    const expired = await sessionRepo.create("customer", customerId, {
      token: sessionRepo.generateToken(),
      familyId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() - DAY),
    });

    const ids = (await sessionRepo.listActive("customer", customerId)).map((r) => r.id);
    assert.ok(ids.includes(live.id), "live session listed");
    assert.ok(!ids.includes(revoked.id), "revoked session hidden");
    assert.ok(!ids.includes(expired.id), "expired session hidden");
  });

  test("listActive never leaks across realms", async () => {
    await sessionRepo.create("staff", staffId, {
      token: sessionRepo.generateToken(),
      familyId: crypto.randomUUID(),
      expiresAt: future(),
    });
    const forCustomer = await sessionRepo.listActive("customer", customerId);
    assert.ok(
      forCustomer.every((r) => r.principalType === "customer" && r.staffId === null),
      "a customer listing must contain no staff rows"
    );
  });

  test("revokeOwnedById refuses a session the principal does not own", async () => {
    const victim = await sessionRepo.create("staff", staffId, {
      token: sessionRepo.generateToken(),
      familyId: crypto.randomUUID(),
      expiresAt: future(),
    });

    // A customer guessing a serial id must not be able to revoke staff sessions.
    const attempt = await sessionRepo.revokeOwnedById(
      "customer",
      customerId,
      victim.id,
      "logout"
    );
    assert.equal(attempt, null, "cross-realm revoke must not match");

    const still = await sessionRepo.findById(victim.id);
    assert.equal(still.revokedAt, null, "victim session untouched");
  });

  test("revokeFamily kills every descendant", async () => {
    const familyId = crypto.randomUUID();
    const members = [];
    for (let i = 0; i < 3; i++) {
      members.push(
        await sessionRepo.create("customer", customerId, {
          token: sessionRepo.generateToken(),
          familyId,
          expiresAt: future(),
        })
      );
    }

    const revoked = await sessionRepo.revokeFamily(familyId, "reuse_detected");
    assert.equal(revoked.length, 3);

    for (const m of members) {
      const row = await sessionRepo.findById(m.id);
      assert.equal(row.revokedReason, "reuse_detected");
    }
  });

  test("revokeAllForPrincipal is scoped to one realm and principal", async () => {
    const staffSession = await sessionRepo.create("staff", staffId, {
      token: sessionRepo.generateToken(),
      familyId: crypto.randomUUID(),
      expiresAt: future(),
    });
    await sessionRepo.create("customer", customerId, {
      token: sessionRepo.generateToken(),
      familyId: crypto.randomUUID(),
      expiresAt: future(),
    });

    await sessionRepo.revokeAllForPrincipal("customer", customerId, "logout_all");

    assert.equal(
      (await sessionRepo.listActive("customer", customerId)).length,
      0,
      "customer sessions all gone"
    );
    const staffRow = await sessionRepo.findById(staffSession.id);
    assert.equal(staffRow.revokedAt, null, "staff sessions untouched");
  });

  test("revoking records the successor in the same statement", async () => {
    const familyId = crypto.randomUUID();
    const old = await sessionRepo.create("customer", customerId, {
      token: sessionRepo.generateToken(),
      familyId,
      expiresAt: future(),
    });
    const next = await sessionRepo.create("customer", customerId, {
      token: sessionRepo.generateToken(),
      familyId,
      expiresAt: future(),
    });

    const claimed = await sessionRepo.revokeById(old.id, "rotated", {
      replacedById: next.id,
    });

    // Atomicity matters: a row that is revoked-as-rotated but has no successor
    // recorded is indistinguishable from a reuse attempt, so a concurrent
    // replay landing in that gap would revoke the whole family for nothing.
    assert.ok(claimed.revokedAt, "revoked");
    assert.equal(claimed.revokedReason, "rotated");
    assert.equal(claimed.replacedById, next.id, "successor set by the same update");

    const touched = await sessionRepo.touch(next.id);
    assert.ok(touched.lastUsedAt, "lastUsedAt is set");
  });
});
