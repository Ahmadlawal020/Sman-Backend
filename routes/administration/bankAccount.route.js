const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const {
  getBankAccounts,
  getBankAccountById,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
} = require("../../controllers/administration/bankAccount.controller");

router.get("/", verifyStaff, getBankAccounts);
router.get("/:id", verifyStaff, getBankAccountById);
router.post("/", verifyStaff, createBankAccount);
router.patch("/:id", verifyStaff, updateBankAccount);
router.delete("/:id", verifyStaff, deleteBankAccount);

module.exports = router;
