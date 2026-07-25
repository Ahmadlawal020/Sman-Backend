const { z } = require("zod");

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const createTruckSchema = z.object({
  plateNumber: z.string().min(1, "Plate number is required").max(20),
  model: z.string().min(1, "Model is required").max(50),
  capacity: z.string().min(1, "Capacity is required").max(50),
  status: z.enum(["In Transit", "Idle", "Maintenance"]).optional(),
  driverRef: z.string().regex(objectIdRegex, "Invalid driver ID").optional().or(z.literal("")),
  fuelLevel: z.coerce.number().min(0).max(100).optional(),
  mileage: z.string().max(50).optional().or(z.literal("")),
  vin: z.string().max(50).optional().or(z.literal("")),
  year: z.coerce.number().int().min(1990).max(new Date().getFullYear() + 1).optional(),
  make: z.string().max(50).optional().or(z.literal("")),
  type: z.string().max(50).optional().or(z.literal("")),
  insuranceExpiry: z.string().optional().or(z.literal("")),
  registrationExpiry: z.string().optional().or(z.literal("")),
  nextServiceMileage: z.coerce.number().positive().optional(),
});

const updateTruckSchema = z.object({
  plateNumber: z.string().min(1).max(20).optional(),
  model: z.string().min(1).max(50).optional(),
  capacity: z.string().min(1).max(50).optional(),
  status: z.enum(["In Transit", "Idle", "Maintenance"]).optional(),
  driverRef: z.string().regex(objectIdRegex, "Invalid driver ID").optional().or(z.literal("")),
  fuelLevel: z.coerce.number().min(0).max(100).optional(),
  mileage: z.string().max(50).optional().or(z.literal("")),
  vin: z.string().max(50).optional().or(z.literal("")),
  year: z.coerce.number().int().min(1990).max(new Date().getFullYear() + 1).optional(),
  make: z.string().max(50).optional().or(z.literal("")),
  type: z.string().max(50).optional().or(z.literal("")),
  insuranceExpiry: z.string().optional().or(z.literal("")),
  registrationExpiry: z.string().optional().or(z.literal("")),
  nextServiceMileage: z.coerce.number().positive().optional(),
});

const truckQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().max(100).optional(),
  status: z.enum(["In Transit", "Idle", "Maintenance", "all"]).optional(),
});

const truckIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, "Invalid truck ID"),
});

module.exports = {
  createTruckSchema,
  updateTruckSchema,
  truckQuerySchema,
  truckIdParamSchema,
};
