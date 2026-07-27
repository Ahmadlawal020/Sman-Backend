const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const misc = require("../../schemas/misc.schema");
const {
  getDrivers,
  getDriverById,
  createDriver,
  updateDriver,
  deleteDriver,
} = require("../../controllers/administration/driver.controller");

router.get("/", verifyStaff, validate({ query: misc.listDrivers }), getDrivers);
router.get("/:id", verifyStaff, validate({ params: misc.idParam }), getDriverById);
router.post("/", verifyStaff, validate({ body: misc.createDriver }), createDriver);
router.patch("/:id", verifyStaff, validate({ params: misc.idParam, body: misc.updateDriver }), updateDriver);
router.delete("/:id", verifyStaff, validate({ params: misc.idParam }), deleteDriver);

module.exports = router;
