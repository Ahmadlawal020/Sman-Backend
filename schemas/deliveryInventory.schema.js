const { z } = require("zod");

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const createDeliveryInventorySchema = z.object({
  truck: z.string().regex(objectIdRegex, "Invalid truck ID"),
  driver: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  product: z.string().regex(objectIdRegex, "Invalid product ID"),
  depot: z.string().regex(objectIdRegex, "Invalid depot ID"),
  quantity: z.coerce.number().positive("Quantity must be positive").max(1000000),
  status: z.enum(["allocated", "in_transit", "delivered", "returned"]).optional().default("allocated"),
  notes: z.string().max(1000).optional().or(z.literal("")),
});

const updateDeliveryInventorySchema = z.object({
  truck: z.string().regex(objectIdRegex).optional(),
  driver: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  product: z.string().regex(objectIdRegex).optional(),
  depot: z.string().regex(objectIdRegex).optional(),
  quantity: z.coerce.number().positive().max(1000000).optional(),
  status: z.enum(["allocated", "in_transit", "delivered", "returned"]).optional(),
  notes: z.string().max(1000).optional().or(z.literal("")),
});

const deliveryInventoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().max(100).optional(),
  status: z.enum(["allocated", "in_transit", "delivered", "returned"]).optional(),
  truck: z.string().regex(objectIdRegex).optional(),
  depot: z.string().regex(objectIdRegex).optional(),
});

const deliveryInventoryIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, "Invalid inventory ID"),
});

module.exports = {
  createDeliveryInventorySchema,
  updateDeliveryInventorySchema,
  deliveryInventoryQuerySchema,
  deliveryInventoryIdParamSchema,
};
