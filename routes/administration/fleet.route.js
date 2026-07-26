const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const {
  idParamSchema,
  createFleetTruckSchema,
  updateFleetTruckSchema,
  fleetQuerySchema,
  fleetLedgerEntrySchema,
  fleetTripSchema,
  statementQuerySchema,
} = require("../../schemas/fleet.schema");
const {
  getFleetTrucks,
  getFleetTruckById,
  createFleetTruck,
  updateFleetTruck,
  getComplianceWatchlist,
  recordLedgerEntry,
  getStatement,
  recordTrip,
  getTrips,
} = require("../../controllers/administration/fleet.controller");

router.get("/", verifyStaff, validate({ query: fleetQuerySchema }), getFleetTrucks);
// Static path before "/:id" so "compliance" is never parsed as a truck id.
router.get("/compliance", verifyStaff, getComplianceWatchlist);
router.get("/:id", verifyStaff, validate({ params: idParamSchema }), getFleetTruckById);
router.post("/", verifyStaff, validate({ body: createFleetTruckSchema }), createFleetTruck);
router.patch(
  "/:id",
  verifyStaff,
  validate({ params: idParamSchema, body: updateFleetTruckSchema }),
  updateFleetTruck
);

// Fleet ledger (immutable): entries are appended, never edited.
router.get(
  "/:id/ledger",
  verifyStaff,
  validate({ params: idParamSchema, query: statementQuerySchema }),
  getStatement
);
router.post(
  "/:id/ledger",
  verifyStaff,
  validate({ params: idParamSchema, body: fleetLedgerEntrySchema }),
  recordLedgerEntry
);

// Trips
router.get(
  "/:id/trips",
  verifyStaff,
  validate({ params: idParamSchema, query: statementQuerySchema }),
  getTrips
);
router.post(
  "/:id/trips",
  verifyStaff,
  validate({ params: idParamSchema, body: fleetTripSchema }),
  recordTrip
);

module.exports = router;
