const { z } = require("zod");

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// Manual postings allowed via the API. Sales/releases post themselves from
// the delivery workflow; staff post payments, discounts, notes, adjustments
// and opening balances.
const postLedgerEntrySchema = z.object({
  direction: z.enum(["debit", "credit"]),
  category: z.enum([
    "opening_balance",
    "sale",
    "purchase",
    "payment",
    "credit_note",
    "debit_note",
    "discount",
    "adjustment",
    "commission",
    "other",
  ]),
  amount: z.coerce.number().positive().max(1000000000),
  description: z.string().max(1000).optional(),
  reference: z.string().max(255).optional(),
  entryDate: z.string().date().optional(),
  metadata: z.record(z.any()).optional(),
});

const statementQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

module.exports = { idParamSchema, postLedgerEntrySchema, statementQuerySchema };
