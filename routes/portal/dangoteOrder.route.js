const express = require("express");
const router = express.Router();
const { authenticateCustomer, requireActiveCustomer } = require("../../middleware/verifyCustomer");
const { requireCsrfForCookieAuth } = require("../../middleware/csrf");
const validate = require("../../middleware/validate");
const dangoteSchemas = require("../../schemas/dangoteOrderRequest.schema");
const {
  createMyDangoteOrder,
  listMyDangoteOrders,
  getMyDangoteOrder,
  payMyDangoteOrder,
  cancelMyDangoteOrder,
} = require("../../controllers/portal/dangoteOrder.controller");

// Every route is the signed-in customer acting on their OWN quote requests.
router.post(
  "/",
  authenticateCustomer,
  requireActiveCustomer,
  requireCsrfForCookieAuth("customer"),
  validate({ body: dangoteSchemas.createMyDangoteOrderRequest }),
  createMyDangoteOrder
);
router.get(
  "/",
  authenticateCustomer,
  validate({ query: dangoteSchemas.listMyDangoteOrderRequests }),
  listMyDangoteOrders
);
router.get(
  "/:id",
  authenticateCustomer,
  validate({ params: dangoteSchemas.idParam }),
  getMyDangoteOrder
);

// Pay an approved quote from wallet balance — a balance-spending state change,
// so it carries CSRF like order placement; the controller scopes it to the
// caller and refuses a foreign request with a 404.
router.post(
  "/:id/pay",
  authenticateCustomer,
  requireActiveCustomer,
  requireCsrfForCookieAuth("customer"),
  validate({ params: dangoteSchemas.idParam }),
  payMyDangoteOrder
);

// Withdraw an unpaid quote request (Pending Review, or Approved + Unpaid).
router.post(
  "/:id/cancel",
  authenticateCustomer,
  requireActiveCustomer,
  requireCsrfForCookieAuth("customer"),
  validate({ params: dangoteSchemas.idParam }),
  cancelMyDangoteOrder
);

module.exports = router;
