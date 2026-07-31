const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const licenseSchemas = require("../../schemas/customerLicense.schema");
const {
  getLicensesByCustomer,
  getAllLicenses,
  getLicenseById,
  createLicense,
  updateLicense,
  deleteLicense,
  reviewLicense,
} = require("../../controllers/administration/customerLicense.controller");

router.get(
  "/",
  verifyStaff,
  validate({ query: licenseSchemas.getAllLicensesQuery }),
  getAllLicenses
);

router.get(
  "/customer/:customerId",
  verifyStaff,
  validate({ params: licenseSchemas.customerIdParam }),
  getLicensesByCustomer
);

router.get(
  "/:id",
  verifyStaff,
  validate({ params: licenseSchemas.licenseIdParam }),
  getLicenseById
);

router.post(
  "/",
  verifyStaff,
  validate({ body: licenseSchemas.createLicense }),
  createLicense
);

router.patch(
  "/:id",
  verifyStaff,
  validate({ params: licenseSchemas.licenseIdParam, body: licenseSchemas.updateLicense }),
  updateLicense
);

router.delete(
  "/:id",
  verifyStaff,
  validate({ params: licenseSchemas.licenseIdParam }),
  deleteLicense
);

router.post(
  "/:id/review",
  verifyStaff,
  validate({ params: licenseSchemas.licenseIdParam, body: licenseSchemas.reviewLicense }),
  reviewLicense
);

module.exports = router;
