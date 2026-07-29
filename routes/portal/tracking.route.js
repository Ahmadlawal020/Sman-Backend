const express = require("express");
const router = express.Router();
const generateLimiter = require("../../middleware/generateLimiter");
const { getTracking } = require("../../controllers/portal/tracking.controller");

// Public and unauthenticated — the order number is the shared secret. The
// limiter is the only gate: sized for a human checking a reference from an
// invoice or SMS, not for enumerating order numbers.
const trackingLimiter = generateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: "Too many tracking lookups. Please try again shortly.",
});

router.get("/:ref", trackingLimiter, getTracking);

module.exports = router;
