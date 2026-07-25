const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const { getStats, getOverview } = require("../../controllers/administration/dashboard.controller");

router.get("/stats", verifyAdmin, getStats);
router.get("/overview", verifyAdmin, getOverview);

module.exports = router;
