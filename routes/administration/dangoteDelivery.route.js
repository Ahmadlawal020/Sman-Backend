const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const { authenticateStaff, requireRole } = verifyStaff;
const validate = require("../../middleware/validate");
const schemas = require("../../schemas/dangoteDelivery.schema");
const {
  listOrders,
  getOrder,
  createOrder,
  approveOrder,
  requestOrderChanges,
  rejectOrder,
  markOrderPaid,
  advanceOrderFulfilment,
  listOrderDocuments,
  verifyOrderDocument,
  rejectOrderDocument,
  downloadOrderDocument,
} = require("../../controllers/administration/dangoteDelivery.controller");

// The staff quote desk for Dangote delivery orders. Replaces the legacy
// /dangote-order-requests endpoints. Review verdicts (approve / send back /
// reject) and document verification share the same role gate as order review
// elsewhere in the admin app.

const reviewer = [
  authenticateStaff,
  requireRole("orders", "super_admin", { message: "Order review access required" }),
];

router.get("/dangote-delivery-orders", verifyStaff, validate({ query: schemas.staffList }), listOrders);
router.get("/dangote-delivery-orders/:id", verifyStaff, getOrder);
router.post(
  "/dangote-delivery-orders",
  verifyStaff,
  validate({ body: schemas.staffCreate }),
  createOrder
);

// Review verdicts
router.post(
  "/dangote-delivery-orders/:id/approve",
  ...reviewer,
  validate({ body: schemas.approveQuote }),
  approveOrder
);
router.post(
  "/dangote-delivery-orders/:id/request-changes",
  ...reviewer,
  validate({ body: schemas.requestChanges }),
  requestOrderChanges
);
router.post(
  "/dangote-delivery-orders/:id/reject",
  ...reviewer,
  validate({ body: schemas.rejectRequest }),
  rejectOrder
);

// Payment (manual until the payment effort lands) + staff-advanced fulfilment
router.post("/dangote-delivery-orders/:id/mark-paid", verifyStaff, markOrderPaid);
router.post("/dangote-delivery-orders/:id/schedule", verifyStaff, advanceOrderFulfilment("schedule"));
router.post("/dangote-delivery-orders/:id/dispatch", verifyStaff, advanceOrderFulfilment("dispatch"));
router.post("/dangote-delivery-orders/:id/complete", verifyStaff, advanceOrderFulfilment("complete"));

// Documents
router.get("/dangote-delivery-orders/:id/documents", verifyStaff, listOrderDocuments);
router.post(
  "/dangote-delivery-orders/:id/documents/:docId/verify",
  ...reviewer,
  validate({ body: schemas.verifyDocument }),
  verifyOrderDocument
);
router.post(
  "/dangote-delivery-orders/:id/documents/:docId/reject",
  ...reviewer,
  validate({ body: schemas.rejectDocument }),
  rejectOrderDocument
);
router.get(
  "/dangote-delivery-orders/:id/documents/:docId/download",
  verifyStaff,
  downloadOrderDocument
);

module.exports = router;
