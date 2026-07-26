const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const misc = require("../../schemas/misc.schema");
const {
  getTrucks,
  getTruckById,
  createTruck,
  updateTruck,
  deleteTruck,
} = require("../../controllers/administration/truck.controller");

router.get("/", verifyStaff, validate({ query: misc.listTrucks }), getTrucks);
router.get("/:id", verifyStaff, validate({ params: misc.idParam }), getTruckById);
router.post("/", verifyStaff, createTruck);
router.patch("/:id", verifyStaff, validate({ params: misc.idParam }), updateTruck);
router.delete("/:id", verifyStaff, validate({ params: misc.idParam }), deleteTruck);

module.exports = router;
