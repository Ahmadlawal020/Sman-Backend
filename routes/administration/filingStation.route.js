const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const {
  getFilingStations,
  getFilingStationById,
  createFilingStation,
  updateFilingStation,
  deleteFilingStation,
} = require("../../controllers/administration/filingStation.controller");

router.get("/", verifyStaff, getFilingStations);
router.get("/:id", verifyStaff, getFilingStationById);
router.post("/", verifyStaff, createFilingStation);
router.patch("/:id", verifyStaff, updateFilingStation);
router.delete("/:id", verifyStaff, deleteFilingStation);

module.exports = router;
