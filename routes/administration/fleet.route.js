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
  fleetLedgerQuerySchema,
} = require("../../schemas/fleet.schema");
const {
  getFleetTrucks,
  getFleetTruckById,
  createFleetTruck,
  updateFleetTruck,
  getComplianceWatchlist,
  recordLedgerEntry,
  getLedgerEntries,
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

// Fleet ledger — same workflow as the Django FleetLedgerEntry screens:
// entries are appended, never edited.
router.get(
  "/:id/ledger",
  verifyStaff,
  validate({ params: idParamSchema, query: fleetLedgerQuerySchema }),
  getLedgerEntries
);
router.post(
  "/:id/ledger",
  verifyStaff,
  validate({ params: idParamSchema, body: fleetLedgerEntrySchema }),
  recordLedgerEntry
);

module.exports = router;
