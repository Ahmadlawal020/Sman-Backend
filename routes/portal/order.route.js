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
  simulateMyPayment,
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
