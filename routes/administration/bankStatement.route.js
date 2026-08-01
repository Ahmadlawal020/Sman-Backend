const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const {
  getMapping,
  saveMapping,
  uploadStatement,
  listStatements,
  deleteStatement,
  searchLines,
  matchLines,
} = require("../../controllers/administration/bankStatement.controller");

// The matching pool, queried while confirming a payment.
router.get("/lines", verifyStaff, searchLines);
router.post("/match", verifyStaff, matchLines);

// Per-account statement format.
router.get("/mapping/:bankAccountId", verifyStaff, getMapping);
router.put("/mapping/:bankAccountId", verifyStaff, saveMapping);

// Statements themselves.
router.get("/", verifyStaff, listStatements);
router.post("/", verifyStaff, uploadStatement);
router.delete("/:id", verifyStaff, deleteStatement);

module.exports = router;
