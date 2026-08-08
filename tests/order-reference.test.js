const assert = require("assert");
const test = require("node:test");
const { generateOrderReference, parseOrderReference } = require("../utils/helpers");

test("generateOrderReference", async (t) => {
  await t.test("should generate reference with multiple-word company names (capped at 2 letters max)", () => {
    assert.strictEqual(generateOrderReference("Honeywell Adada", 10831), "HA10831");
    assert.strictEqual(generateOrderReference("Shell Petroleum Nigeria", 5432), "SP5432");
    assert.strictEqual(generateOrderReference("BP Energy Limited", 999), "BE999");
  });

  await t.test("should generate reference with single-word company names", () => {
    assert.strictEqual(generateOrderReference("Soroman", 10831), "SO10831");
    assert.strictEqual(generateOrderReference("Dangote", 5432), "DA5432");
    assert.strictEqual(generateOrderReference("ExxonMobil", 999), "EX999");
  });

  await t.test("should use default initials when no company name", () => {
    assert.strictEqual(generateOrderReference(null, 10831), "SO10831");
    assert.strictEqual(generateOrderReference("", 5432), "SO5432");
    assert.strictEqual(generateOrderReference("   ", 999), "SO999");
  });

  await t.test("should handle company names with extra whitespace", () => {
    assert.strictEqual(generateOrderReference("  Honeywell   Adada  ", 10831), "HA10831");
    assert.strictEqual(generateOrderReference("   Soroman   ", 5432), "SO5432");
  });

  await t.test("should accept numeric order IDs", () => {
    assert.strictEqual(generateOrderReference("Test Co", 12345), "TC12345");
    assert.strictEqual(generateOrderReference("ABC", 1), "AB1");
  });

  await t.test("should accept string order IDs", () => {
    assert.strictEqual(generateOrderReference("Test Co", "12345"), "TC12345");
    assert.strictEqual(generateOrderReference("ABC", "1"), "AB1");
  });

  await t.test("should be case-insensitive for input, uppercase for output", () => {
    assert.strictEqual(generateOrderReference("honeywell adada", 10831), "HA10831");
    assert.strictEqual(generateOrderReference("SOROMAN", 5432), "SO5432");
  });

  await t.test("should handle three-word company names (max 2 letters)", () => {
    assert.strictEqual(generateOrderReference("Nigerian National Petroleum", 7890), "NN7890");
  });

  await t.test("contains no slash — it has to survive being a URL path segment", () => {
    // GET /api/tracking/:ref matches ONE segment, so a slash in the reference
    // made a pasted reference 404. This is the regression guard for that.
    for (const company of ["Honeywell Adada", "Soroman", "", null]) {
      assert.ok(
        !generateOrderReference(company, 123).includes("/"),
        `reference for ${JSON.stringify(company)} must not contain "/"`
      );
    }
  });
});

test("parseOrderReference", async (t) => {
  await t.test("recovers the id from the current format", () => {
    assert.strictEqual(parseOrderReference("HA10831"), 10831);
    assert.strictEqual(parseOrderReference("SO600"), 600);
    assert.strictEqual(parseOrderReference("AB1"), 1);
  });

  await t.test("still recovers the id from the legacy slashed format", () => {
    // References live in SMS, invoices and QR codes customers keep. Every
    // reference issued before the format change must keep resolving.
    assert.strictEqual(parseOrderReference("HA/10831"), 10831);
    assert.strictEqual(parseOrderReference("SO/600"), 600);
  });

  await t.test("accepts a bare id and ignores case and whitespace", () => {
    assert.strictEqual(parseOrderReference("10831"), 10831);
    assert.strictEqual(parseOrderReference("  ha10831  "), 10831);
    assert.strictEqual(parseOrderReference("so/600"), 600);
  });

  await t.test("round-trips whatever generateOrderReference produces", () => {
    for (const [company, id] of [["Honeywell Adada", 10831], ["Soroman", 1], [null, 999]]) {
      assert.strictEqual(parseOrderReference(generateOrderReference(company, id)), id);
    }
  });

  await t.test("rejects anything not reference-shaped", () => {
    // Free-text search must not be mistaken for a reference — otherwise
    // searching "Dangote Cement 50" would drag in unrelated order #50.
    for (const junk of ["Dangote Cement 50", "", "   ", null, undefined, "ABC", "SO/0", "12.5"]) {
      assert.strictEqual(parseOrderReference(junk), null, `${JSON.stringify(junk)} is not a reference`);
    }
  });
});
