const { z } = require("zod");

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const createDeliveryCustomerSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  email: z.string().email("Invalid email").max(255).optional().or(z.literal("")),
  phone: z.string().min(1, "Phone is required").max(20),
  companyName: z.string().max(200).optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
  state: z.string().max(100).optional().or(z.literal("")),
});

const updateDeliveryCustomerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().max(255).optional().or(z.literal("")),
  phone: z.string().min(1).max(20).optional(),
  companyName: z.string().max(200).optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
  state: z.string().max(100).optional().or(z.literal("")),
  isActive: z.boolean().optional(),
});

const deliveryCustomerQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().max(100).optional(),
});

const deliveryCustomerIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, "Invalid delivery customer ID"),
});

module.exports = {
  createDeliveryCustomerSchema,
  updateDeliveryCustomerSchema,
  deliveryCustomerQuerySchema,
  deliveryCustomerIdParamSchema,
};
