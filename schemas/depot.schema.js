const { z } = require("zod");

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const createDepotSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  code: z.string().min(1, "Code is required").max(20),
  address: z.string().min(1, "Address is required").max(500),
  city: z.string().min(1, "City is required").max(100),
  state: z.string().min(1, "State is required").max(100),
  country: z.string().min(1, "Country is required").max(100),
  postcode: z.string().min(1, "Postcode is required").max(20),
  maxCapacity: z.coerce.number().positive("Max capacity must be positive").min(1),
  establishedYear: z.string().min(1, "Established year is required").max(10),
  parkedTrucksCount: z.coerce.number().min(0).optional(),
  status: z.enum(["Active", "Maintenance", "High Capacity"]).optional(),
  productCapacities: z
    .array(
      z.object({
        product: z.string().regex(objectIdRegex),
        capacity: z.coerce.number().min(0),
      })
    )
    .optional()
    .default([]),
  productPrices: z
    .array(
      z.object({
        product: z.string().regex(objectIdRegex),
        currentPrice: z.coerce.number().positive(),
      })
    )
    .optional()
    .default([]),
  staffIds: z.array(z.string().regex(objectIdRegex)).optional().default([]),
});

const updateDepotSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(20).optional(),
  address: z.string().min(1).max(500).optional(),
  city: z.string().min(1).max(100).optional(),
  state: z.string().min(1).max(100).optional(),
  country: z.string().min(1).max(100).optional(),
  postcode: z.string().min(1).max(20).optional(),
  maxCapacity: z.coerce.number().positive().min(1).optional(),
  establishedYear: z.string().min(1).max(10).optional(),
  parkedTrucksCount: z.coerce.number().min(0).optional(),
  status: z.enum(["Active", "Maintenance", "High Capacity"]).optional(),
  productCapacities: z
    .array(
      z.object({
        product: z.string().regex(objectIdRegex),
        capacity: z.coerce.number().min(0),
      })
    )
    .optional(),
  productPrices: z
    .array(
      z.object({
        product: z.string().regex(objectIdRegex),
        currentPrice: z.coerce.number().positive(),
      })
    )
    .optional(),
  staffIds: z.array(z.string().regex(objectIdRegex)).optional(),
});

const depotQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().max(100).optional(),
});

const depotIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, "Invalid depot ID"),
});

module.exports = {
  createDepotSchema,
  updateDepotSchema,
  depotQuerySchema,
  depotIdParamSchema,
};
