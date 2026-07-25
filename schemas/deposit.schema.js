const { z } = require("zod");

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const depositQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().max(100).optional(),
  type: z.enum(["credit", "debit"]).optional(),
  customer: z.string().regex(objectIdRegex).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

const depositIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, "Invalid deposit ID"),
});

module.exports = {
  depositQuerySchema,
  depositIdParamSchema,
};
