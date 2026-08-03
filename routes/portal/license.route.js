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
  deleteMyLicense,
} = require("../../controllers/portal/license.controller");

// Every route is the signed-in customer acting on their OWN license register.
router.get(
  "/",
  authenticateCustomer,
  validate({ query: licenseSchemas.listMyLicenses }),
  listMyLicenses
);
router.get("/upload-signature", authenticateCustomer, getUploadSignature);
router.post(
  "/",
  authenticateCustomer,
  requireActiveCustomer,
  requireCsrfForCookieAuth("customer"),
  validate({ body: licenseSchemas.createMyLicense }),
  createMyLicense
);

// Remove a license from the register — a state change, so CSRF-protected like
// the create above. The controller scopes it to the caller and refuses (409)
// while a live Dangote request still depends on it.
router.delete(
  "/:id",
  authenticateCustomer,
  requireActiveCustomer,
  requireCsrfForCookieAuth("customer"),
  validate({ params: licenseSchemas.licenseIdParam }),
  deleteMyLicense
);

module.exports = router;
