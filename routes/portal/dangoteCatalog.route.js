const express = require("express");
const router = express.Router();
const generateLimiter = require("../../middleware/generateLimiter");
const { getDangoteCatalog } = require("../../controllers/portal/dangoteOrder.controller");

// Public and read-only, like /api/catalog — the wizard's product picker loads
// before the customer signs in.
const catalogLimiter = generateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: "Too many requests. Please try again shortly.",
});

router.get("/", catalogLimiter, getDangoteCatalog);

module.exports = router;
