const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const { requireRole } = require("../../middleware/verifyAdmin");
const {
  getDeposits,
  getDepositById,
  createDeposit,
} = require("../../controllers/administration/deposit.controller");

router.get("/", verifyAdmin, getDeposits);
router.get("/:id", verifyAdmin, getDepositById);
router.post("/", verifyAdmin, requireRole("super_admin", "finance"), createDeposit);

module.exports = router;
