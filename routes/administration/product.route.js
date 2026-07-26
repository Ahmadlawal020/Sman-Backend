const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const misc = require("../../schemas/misc.schema");
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../../controllers/administration/product.controller");

router.get("/", verifyStaff, validate({ query: misc.listProducts }), getProducts);
router.get("/:id", verifyStaff, validate({ params: misc.idParam }), getProductById);
router.post("/", verifyStaff, validate({ body: misc.createProduct }), createProduct);
router.patch("/:id", verifyStaff, validate({ params: misc.idParam, body: misc.updateProduct }), updateProduct);
router.delete("/:id", verifyStaff, validate({ params: misc.idParam }), deleteProduct);

module.exports = router;
