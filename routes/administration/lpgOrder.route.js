const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const { authenticateStaff, requireRole } = verifyStaff;
const {
  getLpgOrderRequests,
  getLpgOrderRequestById,
  createLpgOrderRequest,
  reviewLpgOrderRequest,
  updateLpgOrderPaymentStatus,
  updateLpgOrderCollectionStatus,
  getPayableLpgOrders,
  payLpgOrder,
} = require("../../controllers/administration/lpgOrder.controller");

router.get("/lpg-order-requests/payable", verifyStaff, getPayableLpgOrders);
router.get("/lpg-order-requests", verifyStaff, getLpgOrderRequests);
router.get("/lpg-order-requests/:id", verifyStaff, getLpgOrderRequestById);
router.post("/lpg-order-requests", verifyStaff, createLpgOrderRequest);
router.put(
  "/lpg-order-requests/:id/review",
  authenticateStaff,
  requireRole("orders", "super_admin", { message: "Order review access required" }),
  reviewLpgOrderRequest
);
router.put(
  "/lpg-order-requests/:id/pay",
  authenticateStaff,
  requireRole("finance", "super_admin", { message: "Finance access required to pay" }),
  payLpgOrder
);
router.put("/lpg-order-requests/:id/payment-status", verifyStaff, updateLpgOrderPaymentStatus);
router.put("/lpg-order-requests/:id/collection-status", verifyStaff, updateLpgOrderCollectionStatus);

module.exports = router;
