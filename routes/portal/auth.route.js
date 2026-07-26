const express = require("express");
const router = express.Router();
const generateLimiter = require("../../middleware/generateLimiter");
const { authenticateCustomer } = require("../../middleware/verifyCustomer");
const { requireCsrfForCookieAuth } = require("../../middleware/csrf");
const {
  handleRegister,
  handleRequestOtp,
  handleVerifyOtp,
  handleRefresh,
  handleLogout,
  handleLogoutAll,
  handleListSessions,
  handleRevokeSession,
  handleGetMe,
} = require("../../controllers/portal/auth.controller");

/**
 * These limiters are a coarse per-process front line; the real per-phone and
 * per-IP budgets are SQL-backed in otp.service, because an in-memory limiter
 * resets on every deploy and multiplies by worker count.
 */
const registerLimiter = generateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many registration attempts. Please try again later.",
});

const otpLimiter = generateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: "Too many verification requests. Please try again later.",
});

const verifyLimiter = generateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many verification attempts. Please try again later.",
});

router.post("/register", registerLimiter, handleRegister);
router.post("/request-otp", otpLimiter, handleRequestOtp);
router.post("/verify-otp", verifyLimiter, handleVerifyOtp);
// CSRF applies only when the refresh token arrives in a cookie; a caller
// sending it in the body is not exposed to CSRF in the first place.
router.post("/refresh", otpLimiter, requireCsrfForCookieAuth("customer"), handleRefresh);
router.post("/logout", requireCsrfForCookieAuth("customer"), handleLogout);

router.get("/me", authenticateCustomer, handleGetMe);
router.post("/logout-all", authenticateCustomer, handleLogoutAll);
router.get("/sessions", authenticateCustomer, handleListSessions);
router.delete("/sessions/:id", authenticateCustomer, handleRevokeSession);

module.exports = router;
