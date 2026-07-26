const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const {
  getTrucks,
  getTruckById,
  createTruck,
  updateTruck,
  deleteTruck,
} = require("../../controllers/administration/truck.controller");

router.get("/", verifyStaff, getTrucks);
router.get("/:id", verifyStaff, getTruckById);
router.post("/", verifyStaff, createTruck);
router.patch("/:id", verifyStaff, updateTruck);
router.delete("/:id", verifyStaff, deleteTruck);

module.exports = router;
