const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const { requireRole } = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const depositSchemas = require("../../schemas/deposit.schema");
const {
  getDeposits,
  getDepositById,
  createDeposit,
  syncPaystackDeposit,
} = require("../../controllers/administration/deposit.controller");

router.post("/sync-paystack", verifyStaff, validate({ body: depositSchemas.syncPaystack }), syncPaystackDeposit);
router.get("/", verifyStaff, validate({ query: depositSchemas.listDeposits }), getDeposits);
router.get("/:id", verifyStaff, validate({ params: depositSchemas.idParam }), getDepositById);
router.post("/", verifyStaff, requireRole("super_admin", "finance"), validate({ body: depositSchemas.createDeposit }), createDeposit);

module.exports = router;
