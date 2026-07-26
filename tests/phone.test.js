const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { toE164, toTermii, isValidNigerianMobile } = require("../utils/phone");

describe("utils/phone — one parser, two renderings", () => {
  test("every accepted input form collapses to the same E.164 value", () => {
    const equivalent = [
      "08012345678",
      "0801 234 5678",
      "0801-234-5678",
      "(0801) 234 5678",
      "8012345678",
      "2348012345678",
      "+2348012345678",
      "+234 801 234 5678",
    ];
    for (const input of equivalent) {
      assert.equal(toE164(input), "+2348012345678", `input: ${input}`);
    }
  });

  test("Termii rendering is the same digits without the plus", () => {
    assert.equal(toTermii("08012345678"), "2348012345678");
    assert.equal(toTermii("+2348012345678"), "2348012345678");
  });

  test("unparseable input returns null rather than a mangled value", () => {
    // A silently mangled number is how a phone column ends up with three
    // formats in it, so these must not round-trip to something plausible.
    for (const bad of ["", null, undefined, "abc", "123", "0801234567", "080123456789", "+1 555 0100"]) {
      assert.equal(toE164(bad), null, `input: ${JSON.stringify(bad)}`);
    }
  });

  test("toTermii yields empty string on failure, not 'null'", () => {
    // The SMS client treats "" as a no-op; the string "null" would be sent.
    assert.equal(toTermii("garbage"), "");
    assert.equal(toTermii(null), "");
  });

  test("mobile validation is stricter than storage", () => {
    assert.ok(isValidNigerianMobile("08012345678"));
    assert.ok(isValidNigerianMobile("+2349087654321"));
    assert.ok(isValidNigerianMobile("07012345678"));

    // A Lagos landline is storable but not SMS-able.
    const landline = "+2341234567890";
    assert.equal(toE164(landline), landline, "landline should still normalise");
    assert.equal(isValidNigerianMobile(landline), false, "but must not pass mobile validation");
  });

  test("normalisation is idempotent", () => {
    const once = toE164("08012345678");
    assert.equal(toE164(once), once);
    assert.equal(toE164(toE164(once)), once);
  });
});
