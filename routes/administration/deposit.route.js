const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const { requireRole } = require("../../middleware/verifyStaff");
const {
  getDeposits,
  getDepositById,
  createDeposit,
  syncPaystackDeposit,
} = require("../../controllers/administration/deposit.controller");

router.post("/sync-paystack", verifyStaff, syncPaystackDeposit);
router.get("/", verifyStaff, getDeposits);
router.get("/:id", verifyStaff, getDepositById);
router.post("/", verifyStaff, requireRole("super_admin", "finance"), createDeposit);

module.exports = router;
