const { z } = require("zod");

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const createDriverSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  phone: z.string().min(1, "Phone is required").max(20),
  email: z.string().email("Invalid email").max(255).optional().or(z.literal("")),
  licenseNumber: z.string().min(1, "License number is required").max(50),
  licenseClass: z.string().min(1, "License class is required").max(50),
  rating: z.coerce.number().min(0).max(5).optional(),
  status: z.enum(["Active", "On Trip", "Off Duty"]).optional(),
  safetyScore: z.coerce.number().min(0).max(100).optional(),
  licenseExpiry: z.string().optional().or(z.literal("")),
});

const updateDriverSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().min(1).max(20).optional(),
  email: z.string().email().max(255).optional().or(z.literal("")),
  licenseNumber: z.string().min(1).max(50).optional(),
  licenseClass: z.string().min(1).max(50).optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  status: z.enum(["Active", "On Trip", "Off Duty"]).optional(),
  safetyScore: z.coerce.number().min(0).max(100).optional(),
  licenseExpiry: z.string().optional().or(z.literal("")),
});

const driverQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().max(100).optional(),
  status: z.enum(["Active", "On Trip", "Off Duty", "all"]).optional(),
});

const driverIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, "Invalid driver ID"),
});

module.exports = {
  createDriverSchema,
  updateDriverSchema,
  driverQuerySchema,
  driverIdParamSchema,
};
