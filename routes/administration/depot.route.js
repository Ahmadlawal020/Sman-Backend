const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const {
  getDepots,
  getDepotById,
  createDepot,
  updateDepot,
  deleteDepot,
  updateProductPrice,
} = require("../../controllers/administration/depot.controller");

router.get("/", verifyAdmin, getDepots);
router.get("/:id", verifyAdmin, getDepotById);
router.post("/", verifyAdmin, createDepot);
router.patch("/:id", verifyAdmin, updateDepot);
router.patch("/:id/product-price", verifyAdmin, updateProductPrice);
router.delete("/:id", verifyAdmin, deleteDepot);

module.exports = router;
