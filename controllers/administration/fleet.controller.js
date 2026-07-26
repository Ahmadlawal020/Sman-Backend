const asyncHandler = require("express-async-handler");
const { fleetTruckRepo } = require("../../repositories");
const fleetService = require("../../services/fleet.service");
const { sendServiceResult } = require("../../utils/serviceResult");
const { staffActor } = require("../../utils/actor");

const getFleetTrucks = asyncHandler(async (req, res) => {
  const result = await fleetTruckRepo.findAll(req.query);
  res.json({ success: true, data: result });
});

const getFleetTruckById = asyncHandler(async (req, res) => {
  const truck = await fleetTruckRepo.findById(req.params.id);
  if (!truck) {
    return res.status(404).json({ success: false, message: "Fleet truck not found" });
  }
  res.json({ success: true, data: { truck } });
});

const createFleetTruck = asyncHandler(async (req, res) => {
  const result = await fleetService.createTruck(req.body, { actor: staffActor(req) });
  sendServiceResult(res, result, { successStatus: 201, message: "Fleet truck created" });
});

const updateFleetTruck = asyncHandler(async (req, res) => {
  const result = await fleetService.updateTruck(req.params.id, req.body, { actor: staffActor(req) });
  sendServiceResult(res, result, { message: "Fleet truck updated" });
});

const getComplianceWatchlist = asyncHandler(async (req, res) => {
  // Everything expiring in the next 30 days by default.
  const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
  const byDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const trucks = await fleetTruckRepo.findExpiringCompliance(byDate);
  res.json({ success: true, data: { byDate, trucks } });
});

const recordLedgerEntry = asyncHandler(async (req, res) => {
  const result = await fleetService.recordLedgerEntry(req.params.id, req.body, {
    actor: staffActor(req),
  });
  sendServiceResult(res, result, { successStatus: 201, message: "Ledger entry recorded" });
});

const getStatement = asyncHandler(async (req, res) => {
  const statement = await fleetService.getStatement(req.params.id, req.query);
  res.json({ success: true, data: statement });
});

const recordTrip = asyncHandler(async (req, res) => {
  const result = await fleetService.recordTrip(req.params.id, req.body, { actor: staffActor(req) });
  sendServiceResult(res, result, { successStatus: 201, message: "Trip recorded" });
});

const getTrips = asyncHandler(async (req, res) => {
  const result = await fleetTruckRepo.findTrips({ ...req.query, fleetTruckId: req.params.id });
  res.json({ success: true, data: result });
});

module.exports = {
  getFleetTrucks,
  getFleetTruckById,
  createFleetTruck,
  updateFleetTruck,
  getComplianceWatchlist,
  recordLedgerEntry,
  getStatement,
  recordTrip,
  getTrips,
};
