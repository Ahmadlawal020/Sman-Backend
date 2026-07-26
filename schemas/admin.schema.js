const { z } = require("zod");

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const VALID_ROLES = [
  "super_admin", "admin", "finance", "truck_sales", "ticketing",
  "security", "transport", "release", "audit", "sales_manager",
  "product_manager", "lpg_dashboard", "lpg_plants", "lpg_stock",
  "lpg_sales", "commissions", "commission_officer", "dispatch", "it_compliance",
];

const MAX_ROLE_ID = 18;

const createAdminSchema = z.object({
  first_name: z.string().min(1, "First name is required").max(100),
  surname: z.string().min(1, "Surname is required").max(100),
  other_names: z.string().max(100).optional().or(z.literal("")),
  email: z.string().email("Invalid email").max(255),
  phone_number: z.string().max(20).optional().or(z.literal("")),
  roles: z
    .array(z.number().int().min(0).max(MAX_ROLE_ID))
    .min(1, "At least one role is required")
    .optional()
    .default([1]),
  suspended: z.boolean().optional().default(false),
});

const updateAdminSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  surname: z.string().min(1).max(100).optional(),
  other_names: z.string().max(100).optional().or(z.literal("")),
  email: z.string().email().max(255).optional(),
  phone_number: z.string().max(20).optional().or(z.literal("")),
  roles: z.array(z.number().int().min(0).max(MAX_ROLE_ID)).min(1).optional(),
  suspended: z.boolean().optional(),
});

const adminQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().max(100).optional(),
  role: z.coerce.number().int().min(0).max(MAX_ROLE_ID).optional(),
});

const adminIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, "Invalid admin ID"),
});

module.exports = {
  createAdminSchema,
  updateAdminSchema,
  adminQuerySchema,
  adminIdParamSchema,
  VALID_ROLES,
};
