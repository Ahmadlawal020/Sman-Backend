const express = require("express");
const router = express.Router();
const { authenticateCustomer, requireActiveCustomer } = require("../../middleware/verifyCustomer");
const { requireCsrfForCookieAuth } = require("../../middleware/csrf");
const validate = require("../../middleware/validate");
const uploadSchemas = require("../../schemas/upload.schema");
const { deleteMyUpload } = require("../../controllers/portal/upload.controller");

// Deleting a Cloudinary asset is a state change, so it carries CSRF like the
// other portal writes. The controller scopes the publicId to the customer
// upload folder before touching Cloudinary.
router.post(
  "/delete",
  authenticateCustomer,
  requireActiveCustomer,
  requireCsrfForCookieAuth("customer"),
  validate({ body: uploadSchemas.deleteUpload }),
  deleteMyUpload
);

module.exports = router;
