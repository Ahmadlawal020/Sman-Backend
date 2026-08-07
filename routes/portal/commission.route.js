const express = require("express");
const router = express.Router();
const { authenticateCustomer } = require("../../middleware/verifyCustomer");
const {
  getMyCommissions,
  getMySummary,
} = require("../../controllers/portal/commission.controller");

router.get("/", authenticateCustomer, getMyCommissions);
router.get("/summary", authenticateCustomer, getMySummary);

module.exports = router;
