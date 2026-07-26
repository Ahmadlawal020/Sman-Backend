require("dotenv").config();
const { staffRepo, customerRepo } = require("../repositories");
const { client } = require("../config/db");

/**
 * Declares the native-app transport, which is the only mode that returns the
 * refresh token in the response body. Browsers get an httpOnly cookie instead,
 * so any test that needs to hold a refresh token must ask for this — exactly
 * as the mobile client does.
 */
const NATIVE_TRANSPORT = { "X-Auth-Transport": "body" };

const TEST_CUSTOMER = {
  name: "Test Customer",
  // Must be a MOBILE number, not TOLL_FREE — the OTP path requires an
  // SMS-capable type, so a toll-free fixture would pass storage and fail send.
  phone: "+2348099999999",
  companyName: "Test Co",
};

const TEST_STAFF = {
  firstName: "Test",
  surname: "Staff",
  email: "test-staff@soroman.test",
  password: "TestPassw0rd!",
  roles: ["admin", "super_admin"],
};

/** Idempotently ensure a login-capable staff row exists. */
async function ensureTestStaff() {
  const existing = await staffRepo.findByEmail(TEST_STAFF.email);
  if (existing) {
    // Always reset the credential so a half-written row from an earlier run
    // cannot poison the suite. update() hashes `password` itself.
    await staffRepo.update(existing.id, {
      password: TEST_STAFF.password,
      isPasswordSet: true,
      roles: TEST_STAFF.roles,
      isActive: true,
      suspended: false,
    });
    return staffRepo.findByEmail(TEST_STAFF.email);
  }
  // NOTE: staffRepo.create hashes `password` itself — pass it in plaintext.
  return staffRepo.create({
    firstName: TEST_STAFF.firstName,
    surname: TEST_STAFF.surname,
    email: TEST_STAFF.email,
    password: TEST_STAFF.password,
    isPasswordSet: true,
    roles: TEST_STAFF.roles,
    isActive: true,
    suspended: false,
  });
}

/**
 * The postgres pool keeps the event loop alive; tests must close it.
 * Idempotent — several test files each register an after() hook.
 */
let closed = false;
async function closeDb() {
  if (closed) return;
  closed = true;
  await client.end({ timeout: 5 });
}

/**
 * A staff row holding exactly the given roles, plus a real access token for it.
 *
 * Hand-signing a JWT no longer works: tokens must carry a `sid` bound to a live
 * session, so tests have to go through the real issue path.
 */
async function staffTokenWithRoles(roles, email = "test-weak-staff@soroman.test") {
  const sessionService = require("../services/session.service");
  const existing = await staffRepo.findByEmail(email);
  const staffRow = existing
    ? await staffRepo.update(existing.id, { roles, isActive: true, suspended: false })
    : await staffRepo.create({
        firstName: "Weak",
        surname: "Staff",
        email,
        password: "TestPassw0rd!",
        isPasswordSet: true,
        roles,
        isActive: true,
        suspended: false,
      });

  const { accessToken, refreshToken } = await sessionService.issue("staff", staffRow, {});
  return { staff: staffRow, accessToken, refreshToken };
}

/** Log in and return an access token. */
async function staffToken(request, app) {
  await ensureTestStaff();
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: TEST_STAFF.email, password: TEST_STAFF.password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken;
}

/** Idempotently ensure a customer row exists, for session/OTP fixtures. */
async function ensureTestCustomer() {
  const existing = await customerRepo.findByPhone(TEST_CUSTOMER.phone);
  if (existing) return existing;
  return customerRepo.create({
    name: TEST_CUSTOMER.name,
    phone: TEST_CUSTOMER.phone,
    companyName: TEST_CUSTOMER.companyName,
    status: "Pending",
  });
}

module.exports = {
  NATIVE_TRANSPORT,
  TEST_STAFF,
  TEST_CUSTOMER,
  ensureTestStaff,
  ensureTestCustomer,
  staffToken,
  staffTokenWithRoles,
  closeDb,
};
