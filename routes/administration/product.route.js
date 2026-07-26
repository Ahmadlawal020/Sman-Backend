const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../../controllers/administration/product.controller");

router.get("/", verifyStaff, getProducts);
router.get("/:id", verifyStaff, getProductById);
router.post("/", verifyStaff, createProduct);
router.patch("/:id", verifyStaff, updateProduct);
router.delete("/:id", verifyStaff, deleteProduct);

module.exports = router;
