const express = require("express");
const router = express.Router();
const { authenticateCustomer, requireActiveCustomer } = require("../../middleware/verifyCustomer");
const { requireCsrfForCookieAuth } = require("../../middleware/csrf");
const validate = require("../../middleware/validate");
const orderSchemas = require("../../schemas/order.schema");
const {
  createMyOrder,
  listMyOrders,
  getMyOrder,
  getMyOrderByRef,
  simulateMyPayment,
  updateMyOrderTrucks,
} = require("../../controllers/portal/order.controller");

// Every route here is the signed-in customer acting on their OWN orders.
// authenticateCustomer populates req.customer from the token; requireActiveCustomer
// blocks a registered-but-unproven (Pending) account from ordering. Placing an
// order is a cookie-session state change, so it carries CSRF protection.
router.post(
  "/",
  authenticateCustomer,
  requireActiveCustomer,
  requireCsrfForCookieAuth("customer"),
  validate({ body: orderSchemas.createMyOrder }),
  createMyOrder
);

router.get(
  "/",
  authenticateCustomer,
  validate({ query: orderSchemas.listMyOrders }),
  listMyOrders
);

// By-reference lookup. Registered before "/:id" so the two-segment path is
// matched here rather than being mistaken for a numeric id; order numbers are
// the reference customers actually hold (invoice, SMS, dashboard).
router.get(
  "/by-ref/:ref",
  authenticateCustomer,
  validate({ params: orderSchemas.refParam }),
  getMyOrderByRef
);

// Replace pickup truck declaration — same by-ref key the dashboard already uses.
router.patch(
  "/by-ref/:ref/trucks",
  authenticateCustomer,
  requireActiveCustomer,
  requireCsrfForCookieAuth("customer"),
  validate({ params: orderSchemas.refParam, body: orderSchemas.updateMyTrucks }),
  updateMyOrderTrucks
);

router.get(
  "/:id",
  authenticateCustomer,
  validate({ params: orderSchemas.idParam }),
  getMyOrder
);

// Test-only: simulate a bank transfer for one of the customer's own orders so a
// tester can drive it to Paid from the web invoice page. The controller refuses
// unless the server is in test mode (403); it's a cookie-session state change,
// so it carries CSRF protection like the order-placement route above.
router.post(
  "/:id/simulate-payment",
  authenticateCustomer,
  requireActiveCustomer,
  requireCsrfForCookieAuth("customer"),
  validate({ params: orderSchemas.idParam }),
  simulateMyPayment
);

module.exports = router;
