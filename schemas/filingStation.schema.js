const { z } = require("zod");

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const createFilingStationSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  code: z.string().min(1, "Code is required").max(20),
  address: z.string().min(1, "Address is required").max(500),
  state: z.string().min(1, "State is required").max(100),
  city: z.string().max(100).optional().or(z.literal("")),
  phone: z.string().max(20).optional().or(z.literal("")),
  email: z.string().email().max(255).optional().or(z.literal("")),
  manager: z.string().max(200).optional().or(z.literal("")),
  assignedDepot: z.string().regex(objectIdRegex).optional().or(z.literal("")),
});

const updateFilingStationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(20).optional(),
  address: z.string().min(1).max(500).optional(),
  state: z.string().min(1).max(100).optional(),
  city: z.string().max(100).optional().or(z.literal("")),
  phone: z.string().max(20).optional().or(z.literal("")),
  email: z.string().email().max(255).optional().or(z.literal("")),
  manager: z.string().max(200).optional().or(z.literal("")),
  assignedDepot: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  isActive: z.boolean().optional(),
});

const filingStationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
});

const filingStationIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, "Invalid filing station ID"),
});

module.exports = {
  createFilingStationSchema,
  updateFilingStationSchema,
  filingStationQuerySchema,
  filingStationIdParamSchema,
};
