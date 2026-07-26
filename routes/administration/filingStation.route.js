const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const {
  getFilingStations,
  getFilingStationById,
  createFilingStation,
  updateFilingStation,
  deleteFilingStation,
} = require("../../controllers/administration/filingStation.controller");

router.get("/", verifyAdmin, getFilingStations);
router.get("/:id", verifyAdmin, getFilingStationById);
router.post("/", verifyAdmin, createFilingStation);
router.patch("/:id", verifyAdmin, updateFilingStation);
router.delete("/:id", verifyAdmin, deleteFilingStation);

module.exports = router;
