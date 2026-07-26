const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const {
  getDepots,
  getDepotById,
  createDepot,
  updateDepot,
  deleteDepot,
  updateProductPrice,
} = require("../../controllers/administration/depot.controller");

router.get("/", verifyStaff, getDepots);
router.get("/:id", verifyStaff, getDepotById);
router.post("/", verifyStaff, createDepot);
router.patch("/:id", verifyStaff, updateDepot);
router.patch("/:id/product-price", verifyStaff, updateProductPrice);
router.delete("/:id", verifyStaff, deleteDepot);

module.exports = router;
