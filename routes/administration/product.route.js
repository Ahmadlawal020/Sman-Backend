const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../../controllers/administration/product.controller");

router.get("/", verifyAdmin, getProducts);
router.get("/:id", verifyAdmin, getProductById);
router.post("/", verifyAdmin, createProduct);
router.patch("/:id", verifyAdmin, updateProduct);
router.delete("/:id", verifyAdmin, deleteProduct);

module.exports = router;
