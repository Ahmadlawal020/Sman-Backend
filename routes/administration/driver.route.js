const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const {
  getDrivers,
  getDriverById,
  createDriver,
  updateDriver,
  deleteDriver,
} = require("../../controllers/administration/driver.controller");

router.get("/", verifyAdmin, getDrivers);
router.get("/:id", verifyAdmin, getDriverById);
router.post("/", verifyAdmin, createDriver);
router.patch("/:id", verifyAdmin, updateDriver);
router.delete("/:id", verifyAdmin, deleteDriver);

module.exports = router;
