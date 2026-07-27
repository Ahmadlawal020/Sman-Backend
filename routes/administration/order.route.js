const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const { authenticateStaff, requireRole } = verifyStaff;
const validate = require("../../middleware/validate");
const orderSchemas = require("../../schemas/order.schema");
const {
  getOrders,
  getOrderById,
  createOrder,
  releaseOrder,
  cancelOrder,
} = require("../../controllers/administration/order.controller");

// Reads and creation stay behind the admin gate (verifyStaff).
router.get("/", verifyStaff, validate({ query: orderSchemas.listOrders }), getOrders);
router.get("/:id", verifyStaff, validate({ params: orderSchemas.idParam }), getOrderById);
router.post("/", verifyStaff, validate({ body: orderSchemas.createOrder }), createOrder);

// Lifecycle transitions are role-gated to the desk that owns the action, and
// each flows through the state machine (see services/orderStatus.service.js).
// The raw `PUT /:id` status setter and `POST /:id/complete` are removed (H1):
// Released is a "release"-desk action; Loading/Completed are driven by truck
// gate actions in a later commit; cancel + refund belongs to finance.
router.post(
  "/:id/release",
  authenticateStaff,
  requireRole("release", "super_admin", { message: "Release desk access required" }),
  validate({ params: orderSchemas.idParam, body: orderSchemas.releaseOrder }),
  releaseOrder
);
router.post(
  "/:id/cancel",
  authenticateStaff,
  requireRole("finance", "super_admin", { message: "Finance access required to cancel" }),
  validate({ params: orderSchemas.idParam, body: orderSchemas.cancelOrder }),
  cancelOrder
);

module.exports = router;
