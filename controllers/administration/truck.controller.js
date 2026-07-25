const asyncHandler = require("express-async-handler");
const { truckRepo, driverRepo } = require("../../repositories");
const { db } = require("../../config/db");
const { trucks, drivers } = require("../../db/schema");
const { eq } = require("drizzle-orm");

const parseDate = (val) => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

const getTrucks = asyncHandler(async (req, res) => {
  const { search, status, page = 1, limit = 50 } = req.query;

  const result = await truckRepo.findAll({ search, status, page, limit });

  res.json({ success: true, data: result });
});

const getTruckById = asyncHandler(async (req, res) => {
  const truck = await truckRepo.findByIdWithDriver(req.params.id);

  if (!truck) {
    return res.status(404).json({ success: false, message: "Truck not found" });
  }

  const driverHistory = await truckRepo.getDriverHistory(req.params.id);

  res.json({ success: true, data: { truck: { ...truck, previousDrivers: driverHistory } } });
});

const createTruck = asyncHandler(async (req, res) => {
  const {
    plateNumber, model, capacity, status, driverRef,
    fuelLevel, mileage, vin, year, make, type,
    insuranceExpiry, registrationExpiry, nextServiceMileage,
  } = req.body;

  if (!plateNumber || !model || !capacity) {
    return res.status(400).json({
      success: false,
      message: "Plate number, model, and capacity are required",
    });
  }

  const existing = await truckRepo.findByPlateNumber(plateNumber);
  if (existing) {
    return res.status(409).json({
      success: false,
      message: "A truck with this plate number already exists",
    });
  }

  let currentDriverId = null;
  if (driverRef) {
    const driverObj = await driverRepo.findById(driverRef);
    if (driverObj) {
      currentDriverId = driverRef;
    }
  }

  const truck = await truckRepo.create({
    plateNumber: plateNumber.toUpperCase(),
    model,
    capacity,
    status: status || "Idle",
    currentDriverId,
    fuelLevel: fuelLevel ?? 100,
    mileage: mileage || "0 km",
    vin,
    year,
    make,
    type,
    insuranceExpiry: parseDate(insuranceExpiry),
    registrationExpiry: parseDate(registrationExpiry),
    nextServiceMileage,
  });

  // Bidirectional driver sync
  if (currentDriverId) {
    await driverRepo.update(currentDriverId, {
      assignedTruckId: truck.id,
    });
    await truckRepo.addDriverHistory(truck.id, currentDriverId);
  }

  res.status(201).json({
    success: true,
    message: "Truck created successfully",
    data: { truck },
  });
});

const updateTruck = asyncHandler(async (req, res) => {
  const truck = await truckRepo.findById(req.params.id);

  if (!truck) {
    return res.status(404).json({ success: false, message: "Truck not found" });
  }

  const allowedFields = [
    "plateNumber", "model", "capacity", "status", "driverRef",
    "fuelLevel", "mileage", "vin", "year", "make",
    "type", "insuranceExpiry", "registrationExpiry", "nextServiceMileage",
  ];

  const oldDriverId = truck.currentDriverId;
  const oldPlateNumber = truck.plateNumber;

  const updateData = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      if (field === "driverRef") {
        updateData.currentDriverId = req.body[field] || null;
      } else if (field === "insuranceExpiry" || field === "registrationExpiry") {
        updateData[field] = parseDate(req.body[field]);
      } else {
        updateData[field] = req.body[field];
      }
    }
  }

  if (updateData.plateNumber) {
    updateData.plateNumber = updateData.plateNumber.toUpperCase();
  }

  const newDriverId = updateData.currentDriverId !== undefined ? updateData.currentDriverId : oldDriverId;

  await truckRepo.update(truck.id, updateData);

  // Handle driver changes
  if (String(oldDriverId) !== String(newDriverId)) {
    // Unassign old driver
    if (oldDriverId) {
      const oldDriver = await driverRepo.findById(oldDriverId);
      if (oldDriver && String(oldDriver.assignedTruckId) === String(truck.id)) {
        await driverRepo.update(oldDriverId, { assignedTruckId: null });
      }
    }

    // Assign new driver
    if (newDriverId) {
      const newDriver = await driverRepo.findById(newDriverId);
      if (newDriver) {
        // If new driver was on another truck, clean that
        if (newDriver.assignedTruckId && String(newDriver.assignedTruckId) !== String(truck.id)) {
          await truckRepo.update(newDriver.assignedTruckId, { currentDriverId: null });
        }
        await driverRepo.update(newDriverId, { assignedTruckId: truck.id });
        await truckRepo.addDriverHistory(truck.id, newDriverId);
      }
    }
  } else if (newDriverId && updateData.plateNumber && updateData.plateNumber !== oldPlateNumber) {
    // Plate changed but driver same - no driver update needed (no cached plate on driver anymore)
  }

  const updatedTruck = await truckRepo.findByIdWithDriver(truck.id);

  res.json({
    success: true,
    message: "Truck updated successfully",
    data: { truck: updatedTruck },
  });
});

const deleteTruck = asyncHandler(async (req, res) => {
  const truck = await truckRepo.findById(req.params.id);

  if (!truck) {
    return res.status(404).json({ success: false, message: "Truck not found" });
  }

  // Clean up driver assignment
  if (truck.currentDriverId) {
    const driver = await driverRepo.findById(truck.currentDriverId);
    if (driver && String(driver.assignedTruckId) === String(truck.id)) {
      await driverRepo.update(truck.currentDriverId, { assignedTruckId: null });
    }
  }

  await truckRepo.deleteById(truck.id);

  res.json({ success: true, message: "Truck deleted successfully" });
});

module.exports = { getTrucks, getTruckById, createTruck, updateTruck, deleteTruck };
