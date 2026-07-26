const z = require("zod");
const { id, nonEmptyString } = require("./fields");

/**
 * Auth schemas — staff and customer realms.
 *
 * These endpoints are unauthenticated, so they are the most exposed surface in
 * the API and the one place where validation is not merely hygiene.
 *
 * Two deliberate restraints, because tightening the wrong thing here breaks a
 * security property rather than improving one:
 *
 * 1. NO email-format check on login. `/auth/login` must answer identically for
 *    a wrong password and an unknown account. If a malformed address returned
 *    400 while a well-formed unknown one returned 401, the difference between
 *    those responses would be a signal. Presence and length only.
 *
 * 2. NO phone-format check on the OTP endpoints. `request-otp` currently
 *    answers with the same generic 200 whether the number is registered,
 *    unregistered or unparseable, and that uniformity is the whole
 *    enumeration defence. A schema rejecting a malformed number with 400 would
 *    carve a third response out of it. `toE164` in the controller stays the
 *    single authority on what a phone number is.
 */

// --- staff ---------------------------------------------------------------

const login = z.object({
  email: nonEmptyString(255),
  password: nonEmptyString(200),
});

const refresh = z.object({
  // Optional: with cookie transport the token arrives in an httpOnly cookie
  // and the body is legitimately empty. The controller resolves which.
  refreshToken: z.string().trim().min(1).max(200).optional(),
});

const setPassword = z.object({
  token: nonEmptyString(200),
  // The 8-character minimum matches the controller's existing rule.
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

const forgotPassword = z.object({
  email: nonEmptyString(255),
});

const sessionIdParam = z.object({ id });

// --- customer portal -----------------------------------------------------

const register = z.object({
  phone: nonEmptyString(30),
  name: nonEmptyString(255),
  companyName: z.string().trim().max(255).optional(),
  turnstileToken: z.string().max(4096).optional(),
});

const requestOtp = z.object({
  phone: nonEmptyString(30),
});

const verifyOtp = z.object({
  phone: nonEmptyString(30),
  // Length-bounded but not format-checked: a wrong-shaped code must fail the
  // same way a wrong code does, through the attempt-capped comparison, not
  // with a distinguishable 400.
  code: z.string().trim().min(1).max(10),
});

module.exports = {
  login,
  refresh,
  setPassword,
  forgotPassword,
  sessionIdParam,
  register,
  requestOtp,
  verifyOtp,
};
