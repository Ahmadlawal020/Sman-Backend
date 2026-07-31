const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const {
  getDangoteProducts,
  getDangoteProductsActive,
  getDangoteProductById,
  createDangoteProduct,
  updateDangoteProduct,
} = require("../../controllers/administration/dangoteOrder.controller");

// Legacy Dangote cement product catalog only. The /dangote-order-requests
// endpoints were replaced by routes/administration/dangoteDelivery.route.js
// (/dangote-delivery-orders); this router is dropped at cleanup.

router.get("/dangote-products", verifyStaff, getDangoteProducts);
router.get("/dangote-products/active", verifyStaff, getDangoteProductsActive);
router.get("/dangote-products/:id", verifyStaff, getDangoteProductById);
router.post("/dangote-products", verifyStaff, createDangoteProduct);
router.put("/dangote-products/:id", verifyStaff, updateDangoteProduct);

module.exports = router;
