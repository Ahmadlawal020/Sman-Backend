const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const {
  getTrucks,
  getTruckById,
  createTruck,
  updateTruck,
  deleteTruck,
} = require("../../controllers/administration/truck.controller");

router.get("/", verifyAdmin, getTrucks);
router.get("/:id", verifyAdmin, getTruckById);
router.post("/", verifyAdmin, createTruck);
router.patch("/:id", verifyAdmin, updateTruck);
router.delete("/:id", verifyAdmin, deleteTruck);

module.exports = router;
