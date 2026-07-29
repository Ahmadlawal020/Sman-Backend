const asyncHandler = require("express-async-handler");
const { customerRepo, customerOtpRepo, sessionRepo } = require("../../repositories");
const otpService = require("../../services/otp.service");
const botCheck = require("../../services/botCheck.service");
const sessionService = require("../../services/session.service");
const cookieService = require("../../services/cookie.service");
const identityService = require("../../services/identity.service");
const { toE164, checkSmsEligibility } = require("../../utils/phone");
const { constantTimeFloor } = require("../../utils/timing");
const { publicCustomer } = require("../../utils/publicCustomer");

const REALM = "customer";

/**
 * Every OTP-issuing endpoint answers with this, whatever actually happened.
 *
 * The caller learns nothing about whether the number is registered, eligible,
 * rate-limited or unparseable. Those distinctions go to the logs.
 */
const GENERIC_OTP_RESPONSE = {
  success: true,
  message: "If that number can receive a code, one has been sent.",
};

/**
 * Must exceed the slowest branch — an SMS round trip — or the timing itself
 * discloses whether a number is known.
 */
const TIMING_FLOOR_MS = 700;

/**
 * POST /register — { phone, name, companyName?, turnstileToken? }
 *
 * The only endpoint that creates customers, and the only one expected to
 * accept an unknown number. That is precisely why it is separate from
 * request-otp: a single find-or-create endpoint must either send an SMS to any
 * number on earth or behave as an enumeration oracle. Two endpoints let each
 * be honest.
 */
const handleRegister = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const { phone, name, companyName, turnstileToken } = req.body || {};

  // Validated server-side. The client requiring a field is a UX affordance,
  // not a guarantee.
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ success: false, message: "Name is required" });
  }
  if (typeof phone !== "string" || !phone.trim()) {
    return res.status(400).json({ success: false, message: "Phone number is required" });
  }

  const bot = await botCheck.verify(turnstileToken, req.ip);
  if (!bot.ok) {
    return res.status(400).json({ success: false, message: "Verification failed. Please try again." });
  }

  const e164 = toE164(phone);
  if (!e164) {
    // A malformed number is a client error, not an enumeration signal — it
    // reveals nothing about who is registered.
    return res.status(400).json({
      success: false,
      message:
        "Enter a valid phone number. International numbers must include a country code, e.g. +447400123456",
    });
  }

  if (await otpService.isOverDailyCap()) {
    // Global, not per-phone, so a 503 discloses nothing about any number — and
    // silently returning 200 would strand real customers with no signal to
    // anyone that the budget is spent.
    return res.status(503).json({
      success: false,
      message: "Verification is temporarily unavailable. Please try again later.",
    });
  }

  let customer = await customerRepo.findByPhone(e164);
  if (!customer) {
    const eligibility = checkSmsEligibility(e164);
    if (eligibility.ok) {
      customer = await customerRepo.create({
        name: name.trim(),
        phone: e164,
        companyName: typeof companyName === "string" ? companyName.trim() : "",
        status: "Pending",
      });
    }
  }

  if (customer) {
    // Sending to an already-registered number is deliberate: it costs the same
    // as a login SMS, keeps the response indistinguishable, and lets someone
    // who landed on the wrong form in rather than dead-ending them.
    const result = await otpService.issueAndSend(customer, {
      action: "register",
      requestIp: req.ip,
    });
    if (!result.sent) {
      console.warn(`[portal/auth] register: no code sent (${result.reason})`);
    }
  }

  await constantTimeFloor(startedAt, TIMING_FLOOR_MS);
  return res.json(GENERIC_OTP_RESPONSE);
});

/**
 * POST /request-otp — { phone }
 *
 * Login only. An unknown number gets nothing: no row, no SMS, no hint.
 */
const handleRequestOtp = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const { phone } = req.body || {};

  if (typeof phone !== "string" || !phone.trim()) {
    return res.status(400).json({ success: false, message: "Phone number is required" });
  }

  const e164 = toE164(phone);
  const customer = e164 ? await customerRepo.findByPhone(e164) : null;

  if (customer) {
    if (await otpService.isOverDailyCap()) {
      return res.status(503).json({
        success: false,
        message: "Verification is temporarily unavailable. Please try again later.",
      });
    }
    const result = await otpService.issueAndSend(customer, {
      action: "login",
      requestIp: req.ip,
    });
    if (!result.sent) {
      console.warn(`[portal/auth] request-otp: no code sent (${result.reason})`);
    }
  }

  await constantTimeFloor(startedAt, TIMING_FLOOR_MS);
  return res.json(GENERIC_OTP_RESPONSE);
});

/**
 * POST /verify-otp — { phone, code }
 *
 * Completes either flow. Which one it was is answerable from
 * phone_verified_at, so the OTP row carries no `purpose`.
 */
const handleVerifyOtp = asyncHandler(async (req, res) => {
  const { phone, code, trustDevice, deviceName } = req.body || {};

  const reject = () =>
    res.status(401).json({ success: false, message: "Invalid or expired code" });

  if (typeof phone !== "string" || typeof code !== "string") return reject();

  const e164 = toE164(phone);
  if (!e164) return reject();

  const customer = await customerRepo.findByPhone(e164);
  if (!customer) return reject();

  // A deactivated account must not be able to authenticate at all. Checked
  // before the code is consumed, so a suspended customer's code is not burned,
  // and answered with the same rejection so nothing is disclosed.
  if (customer.status === "Inactive") return reject();

  const live = await customerOtpRepo.findLive(customer.id);
  if (!live) return reject();

  if (live.attempts >= customerOtpRepo.MAX_ATTEMPTS) {
    await customerOtpRepo.consume(live.id);
    return reject();
  }

  const expected = customerOtpRepo.hashCode(customer.id, code);
  if (expected !== live.codeHash) {
    const updated = await customerOtpRepo.recordFailedAttempt(live.id);
    // Burn the code at the cap rather than leaving it guessable for the rest
    // of its ten-minute life.
    if (updated && updated.attempts >= customerOtpRepo.MAX_ATTEMPTS) {
      await customerOtpRepo.consume(live.id);
    }
    return reject();
  }

  // Guarded: two requests arriving with the correct code at the same moment
  // must not both mint a session.
  const consumed = await customerOtpRepo.consume(live.id);
  if (!consumed) return reject();

  // Proving control of the number IS the activation gate — there is no staff
  // approval step. `Pending` means "registered, phone not yet proven", and the
  // first successful verification promotes it.
  //
  // Only Pending is promoted. `Inactive` is a staff decision and is refused
  // above; passing an OTP must never undo a deactivation.
  const patch = { phoneVerifiedAt: new Date(), lastLoginAt: new Date() };
  if (customer.status === "Pending") patch.status = "Active";

  const updated = await customerRepo.update(customer.id, patch);

  const { accessToken, refreshToken } = await sessionService.issue(
    REALM,
    updated,
    sessionService.requestContext(req)
  );
  const { refreshToken: bodyToken, csrfToken } = cookieService.applyIssuedToken(
    req,
    res,
    REALM,
    refreshToken
  );

  // Opt-in: remember this device so the customer can use a PIN next time
  // instead of waiting on another OTP. Verifying the OTP is itself the phone
  // proof a trusted device represents, so no extra factor is needed.
  let deviceToken;
  if (trustDevice) {
    const trust = await identityService.trustDevice(updated, {
      deviceName,
      userAgent: req.get("user-agent"),
    });
    deviceToken = trust.deviceToken;
  }

  return res.json({
    success: true,
    message: "Verified",
    data: {
      customer: publicCustomer(updated),
      accessToken,
      ...(bodyToken !== undefined ? { refreshToken: bodyToken } : {}),
      ...(csrfToken !== undefined ? { csrfToken } : {}),
      ...(deviceToken ? { deviceToken } : {}),
    },
  });
});

const handleRefresh = asyncHandler(async (req, res) => {
  const { token: presented } = cookieService.readRefreshToken(req, REALM);
  if (!presented) {
    return res.status(400).json({ success: false, message: "Refresh token required" });
  }

  const result = await sessionService.rotate(
    REALM,
    presented,
    sessionService.requestContext(req)
  );
  if (!result.ok) {
    // Uniform: distinguishing stale from reused would tell an attacker whether
    // a token is being watched.
    cookieService.clearRefreshCookie(res, REALM);
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const customer = await customerRepo.findById(result.session.customerId);
  const { refreshToken: bodyToken, csrfToken } = cookieService.applyIssuedToken(
    req,
    res,
    REALM,
    result.refreshToken
  );

  return res.json({
    success: true,
    message: "Token refreshed",
    data: {
      customer: publicCustomer(customer),
      accessToken: result.accessToken,
      ...(bodyToken !== undefined ? { refreshToken: bodyToken } : {}),
      ...(csrfToken !== undefined ? { csrfToken } : {}),
    },
  });
});

const handleLogout = asyncHandler(async (req, res) => {
  const { token: presented } = cookieService.readRefreshToken(req, REALM);
  cookieService.clearRefreshCookie(res, REALM);
  if (!presented) return res.sendStatus(204);

  const revoked = await sessionService.revoke(REALM, presented, "logout");
  if (!revoked) return res.sendStatus(204);
  return res.json({ success: true, message: "Logged out" });
});

const handleLogoutAll = asyncHandler(async (req, res) => {
  const revoked = await sessionService.revokeAll(REALM, req.customer.id, "logout_all");
  return res.json({
    success: true,
    message: "Signed out of all devices",
    data: { revokedCount: revoked.length },
  });
});

const handleListSessions = asyncHandler(async (req, res) => {
  const rows = await sessionRepo.listActive(REALM, req.customer.id);
  return res.json({
    success: true,
    data: {
      sessions: rows.map((s) => ({
        id: s.id,
        deviceName: s.deviceName,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        lastUsedAt: s.lastUsedAt,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        current: req.authSession?.id === s.id,
      })),
    },
  });
});

const handleRevokeSession = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ success: false, message: "Invalid session id" });
  }

  // Ownership is in the WHERE, so another customer's id simply does not match.
  const revoked = await sessionRepo.revokeOwnedById(REALM, req.customer.id, id, "logout");
  if (!revoked) {
    return res.status(404).json({ success: false, message: "Session not found" });
  }
  return res.json({ success: true, message: "Session revoked" });
});

const handleGetMe = asyncHandler(async (req, res) => {
  return res.json({ success: true, data: { customer: publicCustomer(req.customer) } });
});

module.exports = {
  handleRegister,
  handleRequestOtp,
  handleVerifyOtp,
  handleRefresh,
  handleLogout,
  handleLogoutAll,
  handleListSessions,
  handleRevokeSession,
  handleGetMe,
};
