const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const {
  getPfis,
  getPfiById,
  createPfi,
  updatePfi,
  deletePfi,
} = require("../../controllers/administration/pfi.controller");

router.get("/", verifyStaff, getPfis);
router.get("/:id", verifyStaff, getPfiById);
router.post("/", verifyStaff, createPfi);
router.patch("/:id", verifyStaff, updatePfi);
router.delete("/:id", verifyStaff, deletePfi);

module.exports = router;
