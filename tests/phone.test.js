const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  toE164,
  toSmsRecipient,
  parsePhone,
  checkSmsEligibility,
} = require("../utils/phone");

describe("utils/phone — international, one parser", () => {
  afterEach(() => {
    delete process.env.OTP_ALLOWED_COUNTRIES;
  });

  test("every local Nigerian form collapses to the same E.164 value", () => {
    const equivalent = [
      "08012345678",
      "0801 234 5678",
      "0801-234-5678",
      "(0801) 234 5678",
      "8012345678",
      "2348012345678",
      "+2348012345678",
      "+234 801 234 5678",
      "  +2348012345678  ",
    ];
    for (const input of equivalent) {
      assert.equal(toE164(input), "+2348012345678", `input: ${input}`);
    }
  });

  test("non-Nigerian numbers are accepted, not mangled into +234", () => {
    // The previous hand-rolled normaliser assumed every number was Nigerian
    // and would have corrupted all of these.
    const international = [
      ["+447400123456", "GB"],
      ["+12125551234", "US"],
      ["+233201234567", "GH"],
      ["+27821234567", "ZA"],
      ["+919876543210", "IN"],
      ["+971501234567", "AE"],
    ];
    for (const [input, country] of international) {
      const parsed = parsePhone(input);
      assert.ok(parsed, `${input} should parse`);
      assert.equal(parsed.e164, input, `${input} round-trips`);
      assert.equal(parsed.country, country);
      assert.ok(!parsed.e164.startsWith("+234"), `${input} must not become Nigerian`);
    }
  });

  test("formatting noise is stripped from international numbers too", () => {
    assert.equal(toE164("+44 7400 123456"), "+447400123456");
    assert.equal(toE164("+1 (212) 555-1234"), "+12125551234");
  });

  test("invalid numbers return null rather than a plausible-looking string", () => {
    for (const bad of [
      "",
      null,
      undefined,
      "abc",
      "123",
      "+1234",
      "0801234567", // one digit short
      "080123456789", // one digit long
      "+2341234567890", // well-formed shape, not an assigned range
    ]) {
      assert.equal(toE164(bad), null, `input: ${JSON.stringify(bad)}`);
    }
  });

  test("toSmsRecipient drops the plus and yields empty string on failure", () => {
    assert.equal(toSmsRecipient("08012345678"), "2348012345678");
    assert.equal(toSmsRecipient("+447400123456"), "447400123456");
    // "" is a no-op for the SMS client; the string "null" would be dispatched.
    assert.equal(toSmsRecipient("garbage"), "");
    assert.equal(toSmsRecipient(null), "");
  });

  test("normalisation is idempotent", () => {
    for (const n of ["08012345678", "+447400123456"]) {
      const once = toE164(n);
      assert.equal(toE164(once), once);
      assert.equal(toE164(toE164(once)), once);
    }
  });

  test("SMS eligibility accepts mobile and ambiguous fixed-or-mobile", () => {
    assert.equal(checkSmsEligibility("08012345678").ok, true);
    // The US cannot distinguish mobile from landline, so refusing
    // FIXED_LINE_OR_MOBILE would lock out an entire country.
    const us = parsePhone("+12125551234");
    assert.equal(us.type, "FIXED_LINE_OR_MOBILE");
    assert.equal(checkSmsEligibility("+12125551234").ok, true);
  });

  test("an unparseable number is rejected with a reason, not an exception", () => {
    const result = checkSmsEligibility("garbage");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unparseable");
    assert.equal(result.phone, null);
  });

  test("the country allowlist gates OTP delivery when set", () => {
    // Unrestricted international OTP is the classic toll-fraud surface.
    assert.equal(checkSmsEligibility("+233201234567").ok, true, "unset = allow all");

    process.env.OTP_ALLOWED_COUNTRIES = "NG,GH";
    assert.equal(checkSmsEligibility("08012345678").ok, true, "NG allowed");
    assert.equal(checkSmsEligibility("+233201234567").ok, true, "GH allowed");

    const blocked = checkSmsEligibility("+447400123456");
    assert.equal(blocked.ok, false, "GB not on the list");
    assert.equal(blocked.reason, "country_not_allowed:GB");
    // Still parsed — the number is valid, it is policy that rejects it.
    assert.equal(blocked.phone.e164, "+447400123456");
  });

  test("the allowlist tolerates whitespace and casing", () => {
    process.env.OTP_ALLOWED_COUNTRIES = " ng , gh ";
    assert.equal(checkSmsEligibility("08012345678").ok, true);
    assert.equal(checkSmsEligibility("+447400123456").ok, false);
  });

  test("an empty allowlist means no restriction, not deny-all", () => {
    // A blank env var must not silently lock every customer out.
    process.env.OTP_ALLOWED_COUNTRIES = "   ";
    assert.equal(checkSmsEligibility("+447400123456").ok, true);
  });
});
