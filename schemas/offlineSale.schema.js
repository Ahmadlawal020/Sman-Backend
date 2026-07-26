const { z } = require("zod");

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const createOfflineSaleSchema = z.object({
  state: z.string().max(100).optional(),
  location: z.string().max(255).optional(),
  customerName: z.string().max(255).optional(),
  customerPhone: z.string().max(50).optional(),
  notes: z.string().max(5000).optional(),
  items: z
    .array(
      z.object({
        productId: z.coerce.number().int().positive(),
        quantity: z.coerce.number().int().positive().max(10000000),
        unitPrice: z.coerce.number().nonnegative().max(100000000),
      })
    )
    .min(1)
    .max(50),
});

const offlinePaymentSchema = z.object({
  amount: z.coerce.number().positive().max(1000000000),
  bank: z.string().max(255).optional(),
  reference: z.string().max(255).optional(),
});

const reviewOfflineSaleSchema = z.object({
  approve: z.boolean(),
  reason: z.string().max(2000).optional().default(""),
});

const offlineSaleQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  search: z.string().max(100).optional(),
  reconciled: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

module.exports = {
  idParamSchema,
  createOfflineSaleSchema,
  offlinePaymentSchema,
  reviewOfflineSaleSchema,
  offlineSaleQuerySchema,
};
