const express = require("express");
const router = express.Router();
const { authenticateCustomer } = require("../../middleware/verifyCustomer");
const { getMyDashboard } = require("../../controllers/portal/dashboard.controller");

// The signed-in customer's own home screen. No requireActiveCustomer: a
// Pending customer can still see an (empty) dashboard while they finish
// proving their phone.
router.get("/", authenticateCustomer, getMyDashboard);

module.exports = router;
