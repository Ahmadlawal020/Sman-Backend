const { z } = require("zod");

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const documentSchema = z.object({
  kind: z.string().min(1).max(50),
  name: z.string().max(255).default(""),
  url: z.string().max(2000),
  uploadedAt: z.string().datetime().optional(),
});

const createFleetTruckSchema = z.object({
  plateNumber: z.string().min(2).max(50),
  truckMake: z.string().max(255).optional(),
  chassisNumber: z.string().max(255).optional(),
  maxCapacity: z.coerce.number().int().positive().max(100000).optional(),
  fuelCapacity: z.coerce.number().positive().optional(),
  avgLitresPerTrip: z.coerce.number().positive().optional(),
  mileage: z.coerce.number().int().nonnegative().optional(),
  driverName: z.string().max(255).optional(),
  driverPhone: z.string().max(50).optional(),
  driverAltPhone: z.string().max(50).optional(),
  motorBoyName: z.string().max(255).optional(),
  motorBoyPhone: z.string().max(50).optional(),
  spareDriverName: z.string().max(255).optional(),
  spareDriverPhone: z.string().max(50).optional(),
  insuranceExpiry: z.string().date().optional(),
  roadWorthinessExpiry: z.string().date().optional(),
  lastServiceDate: z.string().date().optional(),
  nextServiceDate: z.string().date().optional(),
  documents: z.array(documentSchema).max(20).optional(),
  passportPhoto: z.string().max(500000).optional(),
  truckStatus: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
});

const updateFleetTruckSchema = createFleetTruckSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const fleetQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().max(100).optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  sort: z.enum(["plateNumber", "createdAt", "mileage", "nextServiceDate"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

// Same shape as the Django FleetLedgerEntry form: expense|income, free-text
// category, amount, business date.
const fleetLedgerEntrySchema = z.object({
  entryType: z.enum(["expense", "income"]),
  category: z.string().min(1).max(100),
  amount: z.coerce.number().positive().max(1000000000),
  entryDate: z.string().date(),
  description: z.string().max(5000).optional(),
});

const fleetLedgerQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  entryType: z.enum(["expense", "income"]).optional(),
  category: z.string().max(100).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

module.exports = {
  idParamSchema,
  createFleetTruckSchema,
  updateFleetTruckSchema,
  fleetQuerySchema,
  fleetLedgerEntrySchema,
  fleetLedgerQuerySchema,
};
