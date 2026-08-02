const express = require("express");
const router = express.Router();
const { authenticateCustomer, requireActiveCustomer } = require("../../middleware/verifyCustomer");
const { requireCsrfForCookieAuth } = require("../../middleware/csrf");
const validate = require("../../middleware/validate");
const lpgSchemas = require("../../schemas/lpgOrderRequest.schema");
const {
  createMyLpgOrder,
  listMyLpgOrders,
  getMyLpgOrder,
} = require("../../controllers/portal/lpgOrder.controller");

// Every route is the signed-in customer acting on their OWN LPG requests.
router.post(
  "/",
  authenticateCustomer,
  requireActiveCustomer,
  requireCsrfForCookieAuth("customer"),
  validate({ body: lpgSchemas.createMyLpgOrderRequest }),
  createMyLpgOrder
);
router.get(
  "/",
  authenticateCustomer,
  validate({ query: lpgSchemas.listLpgOrderRequests }),
  listMyLpgOrders
);
router.get(
  "/:id",
  authenticateCustomer,
  validate({ params: lpgSchemas.idParam }),
  getMyLpgOrder
);

module.exports = router;
