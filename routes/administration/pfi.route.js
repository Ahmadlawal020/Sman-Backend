const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const misc = require("../../schemas/misc.schema");
const {
  getPfis,
  getPfiById,
  createPfi,
  updatePfi,
  deletePfi,
} = require("../../controllers/administration/pfi.controller");

router.get("/", verifyStaff, validate({ query: misc.listPfis }), getPfis);
router.get("/:id", verifyStaff, validate({ params: misc.idParam }), getPfiById);
router.post("/", verifyStaff, createPfi);
router.patch("/:id", verifyStaff, validate({ params: misc.idParam }), updatePfi);
router.delete("/:id", verifyStaff, validate({ params: misc.idParam }), deletePfi);

module.exports = router;
