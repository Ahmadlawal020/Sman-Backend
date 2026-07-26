const express = require("express");
const router = express.Router();
const {
  handleLogin,
  handleRefreshToken,
  handleLogout,
  handleGetMe,
  handleSetPassword,
  handleForgotPassword,
} = require("../../controllers/administration/auth.controller");
const generateLimiter = require("../../middleware/generateLimiter");
const verifyStaff = require("../../middleware/verifyStaff");

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
router.post("/refresh", refreshLimiter, handleRefreshToken);
router.post("/logout", refreshLimiter, handleLogout);
router.get("/me", verifyStaff, handleGetMe);
router.post("/set-password", setPasswordLimiter, handleSetPassword);
router.post("/forgot-password", forgotPasswordLimiter, handleForgotPassword);

module.exports = router;
