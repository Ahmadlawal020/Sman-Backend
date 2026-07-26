const express = require("express");
const router = express.Router();
const {
  handleLogin,
  handleRefreshToken,
  handleLogout,
  handleLogoutAll,
  handleListSessions,
  handleRevokeSession,
  handleGetMe,
  handleSetPassword,
  handleForgotPassword,
} = require("../../controllers/administration/auth.controller");
const generateLimiter = require("../../middleware/generateLimiter");
const verifyStaff = require("../../middleware/verifyStaff");
const { authenticateStaff } = require("../../middleware/verifyStaff");
const { requireCsrfForCookieAuth } = require("../../middleware/csrf");

const loginLimiter = generateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: "Too many login attempts. Please try again after 60 seconds.",
});

const refreshLimiter = generateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many refresh attempts. Please try again after 60 seconds.",
});

const forgotPasswordLimiter = generateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: "Too many password reset requests. Please try again after 15 minutes.",
});

const setPasswordLimiter = generateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many password set attempts. Please try again after 15 minutes.",
});

router.post("/login", loginLimiter, handleLogin);
// CSRF applies only when the refresh token arrives in a cookie; a caller
// sending it in the body is not exposed to CSRF in the first place.
router.post("/refresh", refreshLimiter, requireCsrfForCookieAuth("staff"), handleRefreshToken);
router.post("/logout", refreshLimiter, requireCsrfForCookieAuth("staff"), handleLogout);
router.get("/me", verifyStaff, handleGetMe);

// Session management. `authenticateStaff` rather than the full `verifyStaff`:
// signing out of your own devices is not an elevated action, and gating it on
// admin roles would lock most staff out of their own security controls.
router.post("/logout-all", authenticateStaff, handleLogoutAll);
router.get("/sessions", authenticateStaff, handleListSessions);
router.delete("/sessions/:id", authenticateStaff, handleRevokeSession);
router.post("/set-password", setPasswordLimiter, handleSetPassword);
router.post("/forgot-password", forgotPasswordLimiter, handleForgotPassword);

module.exports = router;
