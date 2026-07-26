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
});

const fleetLedgerEntrySchema = z.object({
  category: z.enum([
    "fuel",
    "repairs",
    "tyres",
    "maintenance",
    "driver_allowance",
    "toll",
    "insurance",
    "registration",
    "expense",
    "income",
    "payment",
  ]),
  amount: z.coerce.number().positive().max(1000000000),
  description: z.string().max(1000).optional(),
  entryDate: z.string().date().optional(),
  reference: z.string().max(255).optional(),
  metadata: z.record(z.any()).optional(),
});

const fleetTripSchema = z.object({
  tripDate: z.string().date(),
  origin: z.string().max(255).optional(),
  destination: z.string().max(255).optional(),
  allocationCode: z.string().max(100).optional(),
  quantityLitres: z.coerce.number().nonnegative().optional(),
  fuelUsedLitres: z.coerce.number().nonnegative().optional(),
  mileageStart: z.coerce.number().int().nonnegative().optional(),
  mileageEnd: z.coerce.number().int().nonnegative().optional(),
  driverName: z.string().max(255).optional(),
  notes: z.string().max(5000).optional(),
}).refine(
  (data) =>
    data.mileageEnd === undefined ||
    data.mileageStart === undefined ||
    data.mileageEnd >= data.mileageStart,
  { message: "mileageEnd cannot be less than mileageStart" }
);

const statementQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

module.exports = {
  idParamSchema,
  createFleetTruckSchema,
  updateFleetTruckSchema,
  fleetQuerySchema,
  fleetLedgerEntrySchema,
  fleetTripSchema,
  statementQuerySchema,
};
