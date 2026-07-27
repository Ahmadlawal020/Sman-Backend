const { fleetTruckRepo } = require("../repositories");
const { emitEvent } = require("./events");

// Fleet domain, same shape as the Django workflow: a truck registry
// ("fleet directory") and per-truck expense/income ledger entries. Entries
// are append-only — the repository exposes no update or delete — so the
// financial history can't be rewritten.

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

const recordLedgerEntry = async (
  truckId,
  { entryType, category, amount, entryDate, description },
  { actor }
) => {
  const truck = await fleetTruckRepo.findById(truckId);
  if (!truck) return { success: false, notFound: true, message: "Fleet truck not found" };

  const entry = await fleetTruckRepo.createLedgerEntry({
    truckId,
    entryType,
    category,
    amount: Number(amount).toFixed(2),
    entryDate,
    description: description || "",
    enteredBy: actor?.name || "",
    recordedBy: actor?.id || null,
  });

  emitEvent("fleet.ledger_entry_added", {
    actor,
    entityType: "fleet_truck",
    entityId: truckId,
    plateNumber: truck.plateNumber,
    entryType,
    category,
    amount: entry.amount,
  });

  return { success: true, entry };
};

module.exports = { createTruck, updateTruck, recordLedgerEntry };
