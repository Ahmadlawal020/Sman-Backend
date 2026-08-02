const express = require("express");
const router = express.Router();
const generateLimiter = require("../../middleware/generateLimiter");
const { getLpgCatalog } = require("../../controllers/portal/lpgOrder.controller");

// Public and read-only, like /api/catalog — sized for humans browsing stations.
const catalogLimiter = generateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: "Too many requests. Please try again shortly.",
});

router.get("/", catalogLimiter, getLpgCatalog);

module.exports = router;
