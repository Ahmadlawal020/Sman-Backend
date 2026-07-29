const express = require("express");
const router = express.Router();
const { authenticateCustomer } = require("../../middleware/verifyCustomer");
const validate = require("../../middleware/validate");
const profileSchemas = require("../../schemas/profile.schema");
const { getMyProfile, updateMyProfile } = require("../../controllers/portal/profile.controller");

// The signed-in customer reading and editing their own record. No
// requireActiveCustomer: a Pending customer may still fix a typo in their
// name while waiting on the OTP that activates them.
router.get("/", authenticateCustomer, getMyProfile);
router.patch(
  "/",
  authenticateCustomer,
  validate({ body: profileSchemas.updateProfile }),
  updateMyProfile
);

module.exports = router;
