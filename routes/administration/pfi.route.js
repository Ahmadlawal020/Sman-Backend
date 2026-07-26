const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const {
  getPfis,
  getPfiById,
  createPfi,
  updatePfi,
  deletePfi,
} = require("../../controllers/administration/pfi.controller");

router.get("/", verifyAdmin, getPfis);
router.get("/:id", verifyAdmin, getPfiById);
router.post("/", verifyAdmin, createPfi);
router.patch("/:id", verifyAdmin, updatePfi);
router.delete("/:id", verifyAdmin, deletePfi);

module.exports = router;
