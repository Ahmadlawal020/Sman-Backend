const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const {
  idParamSchema,
  submitIncidentSchema,
  transitionIncidentSchema,
  incidentQuerySchema,
} = require("../../schemas/incident.schema");
const {
  getIncidents,
  getIncidentById,
  submitIncident,
  transitionIncident,
} = require("../../controllers/administration/incident.controller");

router.get("/", verifyStaff, validate({ query: incidentQuerySchema }), getIncidents);
router.get("/:id", verifyStaff, validate({ params: idParamSchema }), getIncidentById);
router.post("/", verifyStaff, validate({ body: submitIncidentSchema }), submitIncident);
router.post(
  "/:id/transition",
  verifyStaff,
  validate({ params: idParamSchema, body: transitionIncidentSchema }),
  transitionIncident
);

module.exports = router;
