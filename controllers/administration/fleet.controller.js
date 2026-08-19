const asyncHandler = require("express-async-handler");
const { db } = require("../../config/db");
const { eq, desc, count: countFn } = require("drizzle-orm");
const { consumerFleetledgerentry: ledgerEntries, consumerFleettruck: fleetTrucks } = require("../../db/schema");
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

const getLedgerEntries = asyncHandler(async (req, res) => {
  const result = await fleetTruckRepo.findLedgerEntries({ ...req.query, truckId: req.params.id });
  const summary = await fleetTruckRepo.summarizeLedger({
    truckId: req.params.id,
    dateFrom: req.query.dateFrom,
    dateTo: req.query.dateTo,
  });
  res.json({ success: true, data: { ...result, summary } });
});

/** GET /api/fleet/ledger — every entry, for the Directory's money rollup. */
const getAllLedgerEntries = asyncHandler(async (req, res) => {
  // Denormalised plate and driver ride on each row so the table renders in
  // one pass without a second lookup per entry. consumer_fleetledgerentry /
  // consumer_fleettruck are the live tables — this used to query
  // fleet_ledger_entries / fleet_trucks, names from the old clean-room
  // schema that were never carried onto the live one (relation does not
  // exist, 500 on every call).
  const rows = await db
    .select({
      id: ledgerEntries.id,
      entryType: ledgerEntries.entryType,
      category: ledgerEntries.category,
      amount: ledgerEntries.amount,
      date: ledgerEntries.date,
      description: ledgerEntries.description,
      truckId: ledgerEntries.truckId,
      enteredBy: ledgerEntries.enteredBy,
      createdAt: ledgerEntries.createdAt,
      updatedAt: ledgerEntries.updatedAt,
      truckPlate: fleetTrucks.plateNumber,
      truckDriver: fleetTrucks.driverName,
    })
    .from(ledgerEntries)
    .innerJoin(fleetTrucks, eq(fleetTrucks.id, ledgerEntries.truckId))
    .orderBy(desc(ledgerEntries.date), desc(ledgerEntries.id));
  res.json({ success: true, data: { entries: rows } });
});

/** PATCH /api/fleet/ledger/:entryId */
const updateLedgerEntry = asyncHandler(async (req, res) => {
  const id = Number(req.params.entryId);
  const { truckId, entryType, category, amount, entryDate, description } = req.body || {};

  if (entryType && !["expense", "income"].includes(entryType)) {
    return res.status(400).json({ success: false, message: "entryType must be expense or income" });
  }
  if (amount !== undefined && Number(amount) <= 0) {
    return res.status(400).json({ success: false, message: "Amount must be greater than zero" });
  }
  // A bad truck id 404s rather than silently detaching the entry.
  if (truckId !== undefined) {
    const [t] = await db.select({ id: fleetTrucks.id }).from(fleetTrucks).where(eq(fleetTrucks.id, Number(truckId))).limit(1);
    if (!t) return res.status(404).json({ success: false, message: "Truck not found" });
  }

  const updateData = {};
  if (truckId !== undefined) updateData.truckId = Number(truckId);
  if (entryType !== undefined) updateData.entryType = entryType;
  if (category !== undefined) updateData.category = category;
  if (amount !== undefined) updateData.amount = String(amount);
  if (entryDate !== undefined) updateData.date = entryDate;
  if (description !== undefined) updateData.description = description;
  updateData.updatedAt = new Date().toISOString();

  const [row] = await db.update(ledgerEntries).set(updateData).where(eq(ledgerEntries.id, id)).returning();
  if (!row) return res.status(404).json({ success: false, message: "Entry not found" });
  res.json({ success: true, message: "Entry updated", data: { entry: row } });
});

/** DELETE /api/fleet/ledger/:entryId */
const deleteLedgerEntry = asyncHandler(async (req, res) => {
  const [row] = await db.delete(ledgerEntries).where(eq(ledgerEntries.id, Number(req.params.entryId))).returning({ id: ledgerEntries.id });
  if (!row) return res.status(404).json({ success: false, message: "Entry not found" });
  res.json({ success: true, message: "Entry deleted", data: { id: row.id } });
});

/**
 * DELETE /api/fleet/:id
 *
 * Conditional. A truck carrying ledger entries is soft-deleted so the money
 * history stays intact; only a truck with none is actually removed.
 */
const deleteFleetTruck = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [{ entryCount }] = await db
    .select({ entryCount: countFn() })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.truckId, id));

  if (entryCount > 0) {
    const [row] = await db
      .update(fleetTrucks)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(fleetTrucks.id, id))
      .returning({ id: fleetTrucks.id });
    if (!row) return res.status(404).json({ success: false, message: "Truck not found" });
    return res.json({
      success: true,
      message: `Truck retired — ${entryCount} ledger entr${entryCount === 1 ? "y" : "ies"} kept`,
      data: { id, softDeleted: true, entries: entryCount },
    });
  }

  const [row] = await db.delete(fleetTrucks).where(eq(fleetTrucks.id, id)).returning({ id: fleetTrucks.id });
  if (!row) return res.status(404).json({ success: false, message: "Truck not found" });
  res.json({ success: true, message: "Truck deleted", data: { id, softDeleted: false } });
});

module.exports = {
  getFleetTrucks,
  getFleetTruckById,
  createFleetTruck,
  updateFleetTruck,
  getComplianceWatchlist,
  recordLedgerEntry,
  getLedgerEntries,
  getAllLedgerEntries,
  updateLedgerEntry,
  deleteLedgerEntry,
  deleteFleetTruck,
};
