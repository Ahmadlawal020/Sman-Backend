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
