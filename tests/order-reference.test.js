const assert = require("assert");
const test = require("node:test");
const { generateOrderReference } = require("../utils/helpers");

test("generateOrderReference", async (t) => {
  await t.test("should generate reference with multiple-word company names", () => {
    assert.strictEqual(generateOrderReference("Honeywell Adada", 10831), "HA/10831");
    assert.strictEqual(generateOrderReference("Shell Petroleum Nigeria", 5432), "SPN/5432");
    assert.strictEqual(generateOrderReference("BP Energy Limited", 999), "BEL/999");
  });

  await t.test("should generate reference with single-word company names", () => {
    assert.strictEqual(generateOrderReference("Soroman", 10831), "SO/10831");
    assert.strictEqual(generateOrderReference("Dangote", 5432), "DA/5432");
    assert.strictEqual(generateOrderReference("ExxonMobil", 999), "EX/999");
  });

  await t.test("should use default initials when no company name", () => {
    assert.strictEqual(generateOrderReference(null, 10831), "SO/10831");
    assert.strictEqual(generateOrderReference("", 5432), "SO/5432");
    assert.strictEqual(generateOrderReference("   ", 999), "SO/999");
  });

  await t.test("should handle company names with extra whitespace", () => {
    assert.strictEqual(generateOrderReference("  Honeywell   Adada  ", 10831), "HA/10831");
    assert.strictEqual(generateOrderReference("   Soroman   ", 5432), "SO/5432");
  });

  await t.test("should accept numeric order IDs", () => {
    assert.strictEqual(generateOrderReference("Test Co", 12345), "TC/12345");
    assert.strictEqual(generateOrderReference("ABC", 1), "AB/1");
  });

  await t.test("should accept string order IDs", () => {
    assert.strictEqual(generateOrderReference("Test Co", "12345"), "TC/12345");
    assert.strictEqual(generateOrderReference("ABC", "1"), "AB/1");
  });

  await t.test("should be case-insensitive for input, uppercase for output", () => {
    assert.strictEqual(generateOrderReference("honeywell adada", 10831), "HA/10831");
    assert.strictEqual(generateOrderReference("SOROMAN", 5432), "SO/5432");
  });

  await t.test("should handle three-word company names", () => {
    assert.strictEqual(generateOrderReference("Nigerian National Petroleum", 7890), "NNP/7890");
  });
});
