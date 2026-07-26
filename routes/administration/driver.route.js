const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const {
  getDrivers,
  getDriverById,
  createDriver,
  updateDriver,
  deleteDriver,
} = require("../../controllers/administration/driver.controller");

router.get("/", verifyStaff, getDrivers);
router.get("/:id", verifyStaff, getDriverById);
router.post("/", verifyStaff, createDriver);
router.patch("/:id", verifyStaff, updateDriver);
router.delete("/:id", verifyStaff, deleteDriver);

module.exports = router;
