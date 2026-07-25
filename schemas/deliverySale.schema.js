const { z } = require("zod");

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const createDeliverySaleSchema = z.object({
  customer: z.string().regex(objectIdRegex, "Invalid customer ID"),
  customer_name: z.string().max(200).optional().or(z.literal("")),
  sales_value: z.coerce.number().min(0).max(100000000),
  payment_amount: z.coerce.number().min(0).max(100000000).optional().default(0),
  payer_name: z.string().max(200).optional().or(z.literal("")),
  bank: z.string().max(100).optional().or(z.literal("")),
  date_of_payment: z.string().optional().or(z.literal("")),
  deposit_status: z.enum(["paid", "partial", "unpaid"]).optional().default("unpaid"),
  payment_method: z.string().max(50).optional().or(z.literal("")),
  entered_by: z.string().max(200).optional().or(z.literal("")),
  remarks: z.string().max(1000).optional().or(z.literal("")),
});

const updateDeliverySaleSchema = z.object({
  sales_value: z.coerce.number().min(0).max(100000000).optional(),
  payment_amount: z.coerce.number().min(0).max(100000000).optional(),
  payer_name: z.string().max(200).optional().or(z.literal("")),
  bank: z.string().max(100).optional().or(z.literal("")),
  date_of_payment: z.string().optional().or(z.literal("")),
  deposit_status: z.enum(["paid", "partial", "unpaid"]).optional(),
  payment_method: z.string().max(50).optional().or(z.literal("")),
  remarks: z.string().max(1000).optional().or(z.literal("")),
});

const deliverySaleQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().max(100).optional(),
  customer: z.string().regex(objectIdRegex).optional(),
  deposit_status: z.enum(["paid", "partial", "unpaid"]).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

const deliverySaleIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, "Invalid delivery sale ID"),
});

module.exports = {
  createDeliverySaleSchema,
  updateDeliverySaleSchema,
  deliverySaleQuerySchema,
  deliverySaleIdParamSchema,
};
