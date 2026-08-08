const { customerOtpRepo } = require("../repositories");
const { sendSMSWithFallback } = require("./sms.service");
const { checkSmsEligibility } = require("../utils/phone");

/**
 * OTP issuance for customer phone authentication.
 *
 * Verification lives in the controller because it owns the response shape;
 * this module owns everything that decides whether an SMS should leave the
 * building at all.
 */

const CODE_TTL_MINUTES = 10;
const DEFAULT_DAILY_CAP = 500;

/**
 * Per-action limits, counted from customer_otps rather than in memory.
 *
 * The per-phone budget is the precise control: it is tied to the thing being
 * attacked and cannot be evaded by rotating source addresses.
 *
 * The per-IP budget is deliberately loose — a backstop, not a gate. Nigerian
 * mobile networks use carrier-grade NAT heavily, so thousands of legitimate
 * customers can share one public address; a tight per-IP cap would lock out a
 * whole carrier during a busy hour while barely inconveniencing an attacker
 * with a proxy pool. The real bound on a distributed attack is the global
 * daily send cap, not this.
 *
 * Both are env-tunable so ops can react without a deploy.
 */
const envInt = (key, fallback) => {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

const LIMITS = {
  register: {
    get perPhone() {
      return envInt("OTP_REGISTER_PER_PHONE", 2);
    },
    get perIp() {
      return envInt("OTP_REGISTER_PER_IP", 30);
    },
    windowMinutes: 60,
  },
  login: {
    get perPhone() {
      return envInt("OTP_LOGIN_PER_PHONE", 3);
    },
    get perIp() {
      return envInt("OTP_LOGIN_PER_IP", 60);
    },
    windowMinutes: 60,
  },
};

/**
 * Development bypass: a fixed, predictable code and no SMS dispatch.
 *
 * It does NOT skip verification — the code is still hashed, stored, expired
 * and attempt-capped. Only generation and delivery are stubbed, so the
 * verification path under test is the production one.
 *
 * Opt-in and fail-closed: both variables must be set, and it is never inferred
 * from the absence of NODE_ENV. server.js refuses to boot if it is on in
 * production or alongside a live Paystack key.
 */
function devMode() {
  return process.env.OTP_DEV_MODE === "true" && Boolean(process.env.OTP_DEV_CODE);
}

/**
 * The fixed code, but ONLY in dev mode — for surfacing on the OTP screen so
 * testers on an environment with no live SMS can sign in. Null otherwise, and
 * dev mode cannot boot in production, so this is never exposed there.
 */
function devCode() {
  return devMode() ? process.env.OTP_DEV_CODE : null;
}

function dailyCap() {
  const raw = Number(process.env.OTP_DAILY_SEND_CAP);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DAILY_CAP;
}

/**
 * Have we spent today's SMS budget?
 *
 * Every send writes a customer_otps row, so this needs no separate counter.
 * Turnstile reduces volume; only a cap bounds it — and unlike a captcha it
 * also covers retry loops, bad deploys and runaway crons.
 */
async function isOverDailyCap() {
  return (await customerOtpRepo.countToday()) >= dailyCap();
}

/**
 * @returns {{ok: boolean, reason?: string}}
 */
async function checkRateLimits(action, { customerId, requestIp }) {
  const limit = LIMITS[action];
  if (!limit) throw new TypeError(`otp.service: unknown action ${JSON.stringify(action)}`);

  if (customerId) {
    const perPhone = await customerOtpRepo.countSince({
      customerId,
      sinceMinutes: limit.windowMinutes,
    });
    if (perPhone >= limit.perPhone) return { ok: false, reason: "phone_rate_limited" };
  }

  if (requestIp) {
    const perIp = await customerOtpRepo.countSince({
      requestIp,
      sinceMinutes: limit.windowMinutes,
    });
    if (perIp >= limit.perIp) return { ok: false, reason: "ip_rate_limited" };
  }

  return { ok: true };
}

/**
 * Issue a code and send it.
 *
 * Returns a reason rather than throwing, because the caller answers
 * identically whatever happens here — the reason is for logs only.
 *
 * @returns {{sent: boolean, reason: string|null, capped?: boolean}}
 */
async function issueAndSend(customer, { action, requestIp }) {
  const eligibility = checkSmsEligibility(customer.phone);
  if (!eligibility.ok) return { sent: false, reason: eligibility.reason };

  const limited = await checkRateLimits(action, { customerId: customer.id, requestIp });
  if (!limited.ok) return { sent: false, reason: limited.reason };

  // Checked immediately before issuing, so a burst cannot slip past a stale read.
  if (await isOverDailyCap()) {
    return { sent: false, reason: "daily_cap_reached", capped: true };
  }

  const useDevMode = devMode();
  const { code } = await customerOtpRepo.issue(customer.id, {
    ttlMinutes: CODE_TTL_MINUTES,
    requestIp,
    code: useDevMode ? process.env.OTP_DEV_CODE : undefined,
  });

  if (useDevMode) {
    console.warn(
      `[otp] DEV MODE: using the fixed code for customer ${customer.id}; no SMS sent.`
    );
    return { sent: true, reason: "dev_mode" };
  }

  // sendSMSWithFallback, not sendSMSTermii, for two reasons that both showed up
  // as "the customer never got their code":
  //
  //  1. A bare sendSMSTermii() call takes the default `generic` channel. Much
  //     of Nigeria is on the Do-Not-Disturb register, and those numbers are
  //     reachable ONLY via `dnd` — so sign-in failed for exactly the customers
  //     whose order confirmations (which already fall back) arrived fine.
  //  2. sendSMSTermii resolves with { success: false } for a soft provider
  //     rejection rather than throwing, so a try/catch alone saw a rejected
  //     message as a delivered one. The return value has to be checked.
  const result = await sendSMSWithFallback(
    customer.phone,
    `Your Soroman verification code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`
  );

  if (!result.success) {
    // The row is already written, so the code stays valid and the customer can
    // retry. Logged, never surfaced — the response must not reveal whether a
    // send was attempted.
    //
    // `message` carries each channel's own complaint (Termii reports the real
    // reason in the response body, not the HTTP status: a 402 is "Insufficient
    // balance" only once response.data is unwrapped), so a billing or sender-ID
    // failure diagnoses itself from this one line.
    console.error(
      `[otp] SMS send failed for customer ${customer.id}: ${result.message}`
    );
    return { sent: false, reason: "send_failed" };
  }

  return { sent: true, reason: null };
}

module.exports = {
  CODE_TTL_MINUTES,
  LIMITS,
  devMode,
  devCode,
  dailyCap,
  isOverDailyCap,
  checkRateLimits,
  issueAndSend,
};
