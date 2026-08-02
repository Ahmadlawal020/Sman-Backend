const express = require("express");
const router = express.Router();
const { authenticateCustomer, requireActiveCustomer } = require("../../middleware/verifyCustomer");
const { requireCsrfForCookieAuth } = require("../../middleware/csrf");
const validate = require("../../middleware/validate");
const licenseSchemas = require("../../schemas/customerLicense.schema");
const {
  listMyLicenses,
  createMyLicense,
  getUploadSignature,
} = require("../../controllers/portal/license.controller");

// Every route is the signed-in customer acting on their OWN license register.
router.get("/", authenticateCustomer, listMyLicenses);
router.get("/upload-signature", authenticateCustomer, getUploadSignature);
router.post(
  "/",
  authenticateCustomer,
  requireActiveCustomer,
  requireCsrfForCookieAuth("customer"),
  validate({ body: licenseSchemas.createMyLicense }),
  createMyLicense
);

module.exports = router;
