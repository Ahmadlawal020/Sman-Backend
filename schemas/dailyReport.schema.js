const { z } = require("zod");

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const priceBandSchema = z.object({
  price: z.coerce.number().nonnegative(),
  litres: z.coerce.number().nonnegative(),
});

const submitDailyReportSchema = z.object({
  reportDate: z.string().date(),
  location: z.string().min(1).max(255),
  pfiNumber: z.string().max(50).optional().default(""),
  productName: z.string().max(100).optional(),
  carriedOverLoading: z.coerce.number().nonnegative().optional(),
  openingStock: z.coerce.number().nonnegative().optional(),
  receivedStock: z.coerce.number().nonnegative().optional(),
  litresSold: z.coerce.number().nonnegative().optional(),
  avgPrice: z.coerce.number().nonnegative().optional(),
  priceBands: z.array(priceBandSchema).max(20).optional(),
  tankBalance: z.coerce.number().nonnegative().optional(),
  loadingLeftOver: z.coerce.number().nonnegative().optional(),
  amountPaid: z.coerce.number().nonnegative().optional(),
  differentials: z.coerce.number().optional(),
  truckCount: z.coerce.number().int().nonnegative().optional(),
  bankName: z.string().max(255).optional(),
  accountNumber: z.string().max(50).optional(),
  remarks: z.string().max(5000).optional(),
});

const amendDailyReportSchema = submitDailyReportSchema.partial();

const reviewDailyReportSchema = z.object({
  approve: z.boolean(),
  comment: z.string().max(2000).optional().default(""),
});

const dailyReportQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  location: z.string().max(255).optional(),
  status: z.enum(["submitted", "approved", "rejected"]).optional(),
  pfiNumber: z.string().max(50).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  sort: z
    .enum(["reportDate", "location", "createdAt", "totalSalesAmount", "litresSold"])
    .optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

module.exports = {
  idParamSchema,
  submitDailyReportSchema,
  amendDailyReportSchema,
  reviewDailyReportSchema,
  dailyReportQuerySchema,
};
