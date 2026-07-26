const { z } = require("zod");

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const attachmentSchema = z.object({
  name: z.string().max(255),
  url: z.string().max(2000),
  contentType: z.string().max(100).optional(),
  uploadedAt: z.string().datetime().optional(),
});

const submitIncidentSchema = z.object({
  incidentType: z.enum(["incident", "expense", "maintenance", "observation", "compliance"]),
  title: z.string().min(1).max(255),
  description: z.string().max(10000).optional(),
  location: z.string().max(255).optional(),
  amount: z.coerce.number().nonnegative().optional(),
  pfiId: z.coerce.number().int().positive().optional(),
  pfiNumber: z.string().max(100).optional(),
  attachments: z.array(attachmentSchema).max(20).optional(),
  metadata: z.record(z.any()).optional(),
});

const transitionIncidentSchema = z.object({
  status: z.enum(["reviewed", "resolved", "rejected"]),
  statusNote: z.string().max(2000).optional().default(""),
});

const incidentQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  incidentType: z.enum(["incident", "expense", "maintenance", "observation", "compliance"]).optional(),
  status: z.enum(["submitted", "reviewed", "resolved", "rejected"]).optional(),
  search: z.string().max(100).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

module.exports = {
  idParamSchema,
  submitIncidentSchema,
  transitionIncidentSchema,
  incidentQuerySchema,
};
