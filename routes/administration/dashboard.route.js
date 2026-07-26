const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const { getStats, getOverview } = require("../../controllers/administration/dashboard.controller");

router.get("/stats", verifyStaff, getStats);
router.get("/overview", verifyStaff, getOverview);

module.exports = router;
