const { z } = require("zod");

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const ticketQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().max(100).optional(),
  status: z.enum(["Active", "Redeemed", "Expired", "Cancelled"]).optional(),
});

const ticketIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, "Invalid ticket ID"),
});

const redeemTicketSchema = z.object({
  redeemedBy: z.string().max(200).optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
});

module.exports = {
  ticketQuerySchema,
  ticketIdParamSchema,
  redeemTicketSchema,
};
