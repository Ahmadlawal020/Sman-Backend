const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const misc = require("../../schemas/misc.schema");
const {
  getBankAccounts,
  getBankAccountById,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
} = require("../../controllers/administration/bankAccount.controller");

router.get("/", verifyStaff, getBankAccounts);
router.get("/:id", verifyStaff, getBankAccountById);
router.post("/", verifyStaff, validate({ body: misc.createBankAccount }), createBankAccount);
router.patch("/:id", verifyStaff, validate({ params: misc.idParam, body: misc.updateBankAccount }), updateBankAccount);
router.delete("/:id", verifyStaff, validate({ params: misc.idParam }), deleteBankAccount);

module.exports = router;
