const z = require("zod");
const { id, money, requiredString, searchTerm, pagination } = require("./fields");

const listCommissions = pagination.extend({
  search: searchTerm,
  status: z.enum(["all", "pending", "paid"]).optional(),
  depotId: id("Depot id").optional(),
  customerId: id("Customer id").optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
});

const idParam = z.object({ id: id("Commission id") });

const upsertRate = z.object({
  depotId: id("Depot id"),
  productId: id("Product id"),
  commissionRate: money("Commission rate", { min: 0 }),
});

const dailyReport = z.object({
  location: z.string().trim().max(255).optional().default(""),
  pfi: z.string().trim().max(255).optional().default(""),
  date: z.string().trim().optional().default(""),
  litresSold: z.union([z.number(), z.string().trim()]).optional().default("0"),
  truckCount: z.union([z.number(), z.string().trim()]).optional().default("0"),
  customerCount: z.union([z.number(), z.string().trim()]).optional().default("0"),
  orderCount: z.union([z.number(), z.string().trim()]).optional().default("0"),
  totalCommissionPaid: z.union([z.number(), z.string().trim()]).optional().default("0"),
  staffName: z.string().trim().max(255).optional().default(""),
  remarks: z.string().trim().max(2000).optional().default(""),
});

module.exports = { listCommissions, idParam, upsertRate, dailyReport };
