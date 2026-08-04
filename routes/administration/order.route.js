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
  generateOrderTickets,
  getTruckTicketPrintData,
  getOrderTrucks,
  gateInTruck,
  markTruckLoaded,
  gateOutTruck,
  getPayableOrders,
  payOrder,
  reconcileOrderEffects,
} = require("../../controllers/administration/order.controller");

// Payable orders (must be before /:id to avoid param conflict)
router.get("/payable", verifyStaff, getPayableOrders);

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

router.post(
  "/:id/pay",
  authenticateStaff,
  requireRole("finance", "super_admin", { message: "Finance access required to pay" }),
  validate({ params: orderSchemas.idParam }),
  payOrder
);

// Re-run post-payment effects for a paid order whose ticket/commission failed.
router.post(
  "/:id/reconcile",
  authenticateStaff,
  requireRole("finance", "super_admin", { message: "Finance access required" }),
  validate({ params: orderSchemas.idParam }),
  reconcileOrderEffects
);

// The truck gate flow — each checkpoint gated to its security/ticketing post.
router.post(
  "/:id/generate-tickets",
  authenticateStaff,
  requireRole("ticketing", "super_admin", { message: "Ticketing access required" }),
  validate({ params: orderSchemas.idParam }),
  generateOrderTickets
);
router.get("/:id/trucks/:loadId/print", verifyStaff, getTruckTicketPrintData);
router.get("/:id/trucks", verifyStaff, getOrderTrucks);

router.post(
  "/:id/gate-in",
  authenticateStaff,
  requireRole("security_entry", "super_admin", { message: "Entry-gate security access required" }),
  validate({ params: orderSchemas.idParam, body: orderSchemas.gateIn }),
  gateInTruck
);
router.post(
  "/:id/trucks/:loadId/load",
  authenticateStaff,
  requireRole("ticketing", "super_admin", { message: "Ticketing access required" }),
  validate({ params: orderSchemas.loadParam, body: orderSchemas.loadTruck }),
  markTruckLoaded
);
router.post(
  "/:id/trucks/:loadId/gate-out",
  authenticateStaff,
  requireRole("security_exit", "super_admin", { message: "Exit-gate security access required" }),
  validate({ params: orderSchemas.loadParam }),
  gateOutTruck
);

module.exports = router;
