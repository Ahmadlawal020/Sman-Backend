const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const misc = require("../../schemas/misc.schema");
const {
  getFilingStations,
  getFilingStationById,
  createFilingStation,
  updateFilingStation,
  deleteFilingStation,
} = require("../../controllers/administration/filingStation.controller");

router.get("/", verifyStaff, validate({ query: misc.listStations }), getFilingStations);
router.get("/:id", verifyStaff, validate({ params: misc.idParam }), getFilingStationById);
router.post("/", verifyStaff, validate({ body: misc.createStation }), createFilingStation);
router.patch("/:id", verifyStaff, validate({ params: misc.idParam, body: misc.updateStation }), updateFilingStation);
router.delete("/:id", verifyStaff, validate({ params: misc.idParam }), deleteFilingStation);

module.exports = router;
