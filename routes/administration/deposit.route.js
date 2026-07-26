const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const { requireRole } = require("../../middleware/verifyAdmin");
const {
  getDeposits,
  getDepositById,
  createDeposit,
  syncPaystackDeposit,
} = require("../../controllers/administration/deposit.controller");

router.get("/", verifyAdmin, getDeposits);
router.get("/:id", verifyAdmin, getDepositById);
router.post("/", verifyAdmin, requireRole("super_admin", "finance"), createDeposit);
router.post("/sync-paystack", verifyAdmin, syncPaystackDeposit);

module.exports = router;
