const { z } = require("zod");

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const createOrderSchema = z.object({
  customer: z.string().regex(objectIdRegex, "Invalid customer ID"),
  state: z.string().min(1, "State is required").max(100),
  depot: z.string().regex(objectIdRegex, "Invalid depot ID"),
  product: z.string().regex(objectIdRegex, "Invalid product ID"),
  quantity: z.coerce.number().positive("Quantity must be positive").max(1000000, "Quantity too large"),
  deliveryType: z.enum(["delivery", "pickup"], {
    errorMap: () => ({ message: "Delivery type must be 'delivery' or 'pickup'" }),
  }),
});

const updateOrderSchema = z.object({
  status: z.enum(["Pending", "Completed", "Cancelled"]).optional(),
  paymentStatus: z.enum(["Paid", "Unpaid"]).optional(),
});

const orderQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().max(100).optional(),
  status: z.enum(["Pending", "Completed", "Cancelled"]).optional(),
  customer: z.string().regex(objectIdRegex).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

const orderIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, "Invalid order ID"),
});

module.exports = {
  createOrderSchema,
  updateOrderSchema,
  orderQuerySchema,
  orderIdParamSchema,
};
