const { z } = require("zod");

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const createProductSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  sku: z.string().min(1, "SKU is required").max(50),
  category: z.string().min(1, "Category is required").max(100),
  gradeClass: z.string().max(100).optional().or(z.literal("")),
  description: z.string().max(1000).optional().or(z.literal("")),
  density: z.string().max(50).optional().or(z.literal("")),
  flashPoint: z.string().max(50).optional().or(z.literal("")),
  unNumber: z.string().max(50).optional().or(z.literal("")),
  hazardClass: z.string().max(20).optional().or(z.literal("")),
  stockLevel: z.coerce.number().min(0).optional(),
  unit: z.string().max(20).optional().or(z.literal("")),
  supplier: z.string().max(200).optional().or(z.literal("")),
});

const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sku: z.string().min(1).max(50).optional(),
  category: z.string().min(1).max(100).optional(),
  gradeClass: z.string().max(100).optional().or(z.literal("")),
  description: z.string().max(1000).optional().or(z.literal("")),
  density: z.string().max(50).optional().or(z.literal("")),
  flashPoint: z.string().max(50).optional().or(z.literal("")),
  unNumber: z.string().max(50).optional().or(z.literal("")),
  hazardClass: z.string().max(20).optional().or(z.literal("")),
  stockLevel: z.coerce.number().min(0).optional(),
  unit: z.string().max(20).optional().or(z.literal("")),
  supplier: z.string().max(200).optional().or(z.literal("")),
});

const productQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
});

const productIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, "Invalid product ID"),
});

module.exports = {
  createProductSchema,
  updateProductSchema,
  productQuerySchema,
  productIdParamSchema,
};
