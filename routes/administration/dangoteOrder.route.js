const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const { authenticateStaff, requireRole } = verifyStaff;
const {
  getDangoteProducts,
  getDangoteProductsActive,
  getDangoteProductById,
  createDangoteProduct,
  updateDangoteProduct,
  getDangoteOrderRequests,
  getDangoteOrderRequestById,
  createDangoteOrderRequest,
  reviewDangoteOrderRequest,
  updateDangoteOrderPaymentStatus,
  updateDangoteOrderCollectionStatus,
  getDangoteOrderDocuments,
  verifyDangoteOrderDocument,
  rejectDangoteOrderDocument,
  downloadDangoteOrderDocument,
} = require("../../controllers/administration/dangoteOrder.controller");

// Dangote Products
router.get("/dangote-products", verifyStaff, getDangoteProducts);
router.get("/dangote-products/active", verifyStaff, getDangoteProductsActive);
router.get("/dangote-products/:id", verifyStaff, getDangoteProductById);
router.post("/dangote-products", verifyStaff, createDangoteProduct);
router.put("/dangote-products/:id", verifyStaff, updateDangoteProduct);

// Dangote Order Requests
router.get("/dangote-order-requests", verifyStaff, getDangoteOrderRequests);
router.get("/dangote-order-requests/:id", verifyStaff, getDangoteOrderRequestById);
router.post("/dangote-order-requests", verifyStaff, createDangoteOrderRequest);
router.put(
  "/dangote-order-requests/:id/review",
  authenticateStaff,
  requireRole("orders", "super_admin", { message: "Order review access required" }),
  reviewDangoteOrderRequest
);
router.put("/dangote-order-requests/:id/payment-status", verifyStaff, updateDangoteOrderPaymentStatus);
router.put("/dangote-order-requests/:id/collection-status", verifyStaff, updateDangoteOrderCollectionStatus);

// Documents — verify/reject are review actions, so they carry the same role
// gate as the review endpoint itself.
router.get("/dangote-order-requests/:id/documents", verifyStaff, getDangoteOrderDocuments);
router.post(
  "/dangote-order-requests/:id/documents/:docId/verify",
  authenticateStaff,
  requireRole("orders", "super_admin", { message: "Order review access required" }),
  verifyDangoteOrderDocument
);
router.post(
  "/dangote-order-requests/:id/documents/:docId/reject",
  authenticateStaff,
  requireRole("orders", "super_admin", { message: "Order review access required" }),
  rejectDangoteOrderDocument
);
router.get(
  "/dangote-order-requests/:id/documents/:docId/download",
  verifyStaff,
  downloadDangoteOrderDocument
);

module.exports = router;
