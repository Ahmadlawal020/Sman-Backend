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

module.exports = router;
