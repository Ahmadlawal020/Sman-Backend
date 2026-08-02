const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const lpgStationSchemas = require("../../schemas/lpgStation.schema");
const {
  getLpgStations,
  getLpgStationById,
  createLpgStation,
  updateLpgStation,
  deleteLpgStation,
} = require("../../controllers/administration/lpgStation.controller");

router.get("/", verifyStaff, validate({ query: lpgStationSchemas.listLpgStations }), getLpgStations);
router.get("/:id", verifyStaff, validate({ params: lpgStationSchemas.idParam }), getLpgStationById);
router.post("/", verifyStaff, validate({ body: lpgStationSchemas.createLpgStation }), createLpgStation);
router.patch("/:id", verifyStaff, validate({ params: lpgStationSchemas.idParam, body: lpgStationSchemas.updateLpgStation }), updateLpgStation);
router.delete("/:id", verifyStaff, validate({ params: lpgStationSchemas.idParam }), deleteLpgStation);

module.exports = router;
