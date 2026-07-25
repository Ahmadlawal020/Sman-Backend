const asyncHandler = require("express-async-handler");
const { driverRepo, truckRepo } = require("../../repositories");

const parseDate = (val) => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

const getDrivers = asyncHandler(async (req, res) => {
  const { search, status, page = 1, limit = 50 } = req.query;

  const result = await driverRepo.findAll({ search, status, page, limit });

  res.json({ success: true, data: result });
});

const getDriverById = asyncHandler(async (req, res) => {
  const driver = await driverRepo.findByIdWithTruck(req.params.id);

  if (!driver) {
    return res.status(404).json({ success: false, message: "Driver not found" });
  }

  const truckHistory = await driverRepo.getTruckHistory(req.params.id);

  res.json({ success: true, data: { driver: { ...driver, previousTrucks: truckHistory } } });
});

const createDriver = asyncHandler(async (req, res) => {
  const { name, email, phone, licenseNumber, licenseClass, rating, status, safetyScore } = req.body;

  if (!name || !phone || !licenseNumber || !licenseClass) {
    return res.status(400).json({
      success: false,
      message: "Name, phone, license number, and license class are required",
    });
  }

  const existing = await driverRepo.findByLicenseNumber(licenseNumber);
  if (existing) {
    return res.status(409).json({
      success: false,
      message: "A driver with this license number already exists",
    });
  }

  const driver = await driverRepo.create({
    name,
    email: email || "",
    phone,
    licenseNumber,
    licenseClass,
    rating: rating ?? 0,
    status: status || "Active",
    assignedTruckId: null,
    safetyScore: safetyScore ?? 0,
    licenseExpiry: parseDate(req.body.licenseExpiry),
  });

  res.status(201).json({
    success: true,
    message: "Driver created successfully",
    data: { driver },
  });
});

const updateDriver = asyncHandler(async (req, res) => {
  const driver = await driverRepo.findById(req.params.id);

  if (!driver) {
    return res.status(404).json({ success: false, message: "Driver not found" });
  }

  const allowedFields = [
    "name", "email", "phone", "licenseNumber", "licenseClass",
    "rating", "status", "safetyScore", "licenseExpiry",
  ];

  const updateData = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      if (field === "licenseExpiry") {
        updateData[field] = parseDate(req.body[field]);
      } else {
        updateData[field] = req.body[field];
      }
    }
  }

  const updated = await driverRepo.update(driver.id, updateData);

  res.json({
    success: true,
    message: "Driver updated successfully",
    data: { driver: updated },
  });
});

const deleteDriver = asyncHandler(async (req, res) => {
  const driver = await driverRepo.findById(req.params.id);

  if (!driver) {
    return res.status(404).json({ success: false, message: "Driver not found" });
  }

  if (driver.assignedTruckId) {
    const truck = await truckRepo.findById(driver.assignedTruckId);
    if (truck && String(truck.currentDriverId) === String(driver.id)) {
      await truckRepo.update(driver.assignedTruckId, { currentDriverId: null });
    }
  }

  await driverRepo.deleteById(driver.id);

  res.json({ success: true, message: "Driver deleted successfully" });
});

module.exports = { getDrivers, getDriverById, createDriver, updateDriver, deleteDriver };
