const { fleetTruckRepo } = require("../repositories");
const ledgerService = require("./ledger.service");
const { emitEvent } = require("./events");

// Fleet domain: registry + trips are operational data; every naira a truck
// earns or costs goes through the ledger engine (owner_type fleet_truck),
// never onto the truck row.

const EXPENSE_CATEGORIES = [
  "fuel",
  "repairs",
  "tyres",
  "maintenance",
  "driver_allowance",
  "toll",
  "insurance",
  "registration",
  "expense",
];
const INCOME_CATEGORIES = ["income", "payment"];

const createTruck = async (data, { actor }) => {
  const existing = await fleetTruckRepo.findByPlate(data.plateNumber);
  if (existing) {
    return { success: false, message: `A fleet truck with plate ${data.plateNumber} already exists` };
  }
  const truck = await fleetTruckRepo.create({ ...data, createdBy: actor?.id || null });

  emitEvent("fleet.truck_created", {
    actor,
    entityType: "fleet_truck",
    entityId: truck.id,
    plateNumber: truck.plateNumber,
  });

  return { success: true, truck };
};

const updateTruck = async (id, data, { actor }) => {
  const truck = await fleetTruckRepo.findById(id);
  if (!truck) return { success: false, notFound: true, message: "Fleet truck not found" };

  if (data.plateNumber && data.plateNumber !== truck.plateNumber) {
    const clash = await fleetTruckRepo.findByPlate(data.plateNumber);
    if (clash) {
      return { success: false, message: `A fleet truck with plate ${data.plateNumber} already exists` };
    }
  }

  const updated = await fleetTruckRepo.update(id, data);

  emitEvent("fleet.truck_updated", {
    actor,
    entityType: "fleet_truck",
    entityId: id,
    changedFields: Object.keys(data),
  });

  return { success: true, truck: updated };
};

/**
 * Record a financial movement for a truck. Category decides the direction:
 * expenses debit the truck's account (cost), income credits it.
 */
const recordLedgerEntry = async (
  fleetTruckId,
  { category, amount, description, entryDate, reference, metadata },
  { actor }
) => {
  const truck = await fleetTruckRepo.findById(fleetTruckId);
  if (!truck) return { success: false, notFound: true, message: "Fleet truck not found" };

  let direction;
  if (EXPENSE_CATEGORIES.includes(category)) direction = "debit";
  else if (INCOME_CATEGORIES.includes(category)) direction = "credit";
  else return { success: false, message: `'${category}' is not a fleet ledger category` };

  const result = await ledgerService.postEntry({
    ownerType: "fleet_truck",
    ownerId: fleetTruckId,
    ownerName: truck.plateNumber,
    direction,
    category,
    amount,
    description: description || "",
    reference: reference || "",
    entryDate,
    metadata: metadata || null,
    recordedBy: actor?.id || null,
    actor,
  });

  if (result.success && !result.alreadyProcessed) {
    emitEvent("fleet.expense_recorded", {
      actor,
      entityType: "fleet_truck",
      entityId: fleetTruckId,
      category,
      direction,
      amount: String(amount),
    });
  }

  return result;
};

const recordTrip = async (fleetTruckId, data, { actor }) => {
  const truck = await fleetTruckRepo.findById(fleetTruckId);
  if (!truck) return { success: false, notFound: true, message: "Fleet truck not found" };

  const trip = await fleetTruckRepo.createTrip({
    ...data,
    fleetTruckId,
    createdBy: actor?.id || null,
  });

  // A trip with an end mileage advances the truck's odometer, monotonically.
  if (data.mileageEnd && (!truck.mileage || data.mileageEnd > truck.mileage)) {
    await fleetTruckRepo.update(fleetTruckId, { mileage: data.mileageEnd });
  }

  emitEvent("fleet.trip_recorded", {
    actor,
    entityType: "fleet_truck",
    entityId: fleetTruckId,
    tripId: trip.id,
    tripDate: data.tripDate,
  });

  return { success: true, trip };
};

const getStatement = (fleetTruckId, options = {}) =>
  ledgerService.getStatement({ ownerType: "fleet_truck", ownerId: fleetTruckId, ...options });

module.exports = {
  createTruck,
  updateTruck,
  recordLedgerEntry,
  recordTrip,
  getStatement,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
};
