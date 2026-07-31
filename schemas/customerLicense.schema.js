const z = require("zod");
const { id, requiredString } = require("./fields");

const createLicense = z.object({
  customerId: id("Customer id"),
  companyName: requiredString("Company name", 255),
  licenseUrl: z.string().url("License URL must be a valid URL").optional().or(z.literal("")),
  licensePublicId: z.string().optional().or(z.literal("")),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expiry date must be YYYY-MM-DD")
    .optional()
    .or(z.literal("")),
});

const updateLicense = z.object({
  companyName: requiredString("Company name", 255).optional(),
  licenseUrl: z.string().url("License URL must be a valid URL").optional().or(z.literal("")),
  licensePublicId: z.string().optional().or(z.literal("")),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expiry date must be YYYY-MM-DD")
    .optional()
    .or(z.literal("")),
});

const reviewLicense = z.object({
  approve: z.boolean(),
  comment: z.string().max(2000).optional().default(""),
});

const getAllLicensesQuery = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

const customerIdParam = z.object({ customerId: id("Customer id") });
const licenseIdParam = z.object({ id: id("License id") });

module.exports = {
  createLicense,
  updateLicense,
  reviewLicense,
  getAllLicensesQuery,
  customerIdParam,
  licenseIdParam,
};
