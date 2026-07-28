const express = require("express");
const router = express.Router();
const generateLimiter = require("../../middleware/generateLimiter");
const { getCatalog } = require("../../controllers/portal/catalog.controller");

// Unauthenticated and read-only, so the limiter is the only gate. The budget
// is sized for humans browsing (a page load costs one call), not scrapers
// polling prices — anyone hitting it harder than this is not a customer.
const catalogLimiter = generateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: "Too many requests. Please try again shortly.",
});

router.get("/", catalogLimiter, getCatalog);

module.exports = router;
