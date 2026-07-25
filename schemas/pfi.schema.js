const { z } = require("zod");

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const createPfiSchema = z.object({
  pfi_number: z.string().min(1, "PFI number is required").max(50),
  description: z.string().max(1000).optional().or(z.literal("")),
  pfi_date: z.string().optional().or(z.literal("")),
  location_id: z.string().regex(objectIdRegex, "Invalid depot ID").optional().or(z.literal("")),
  product_id: z.string().regex(objectIdRegex, "Invalid product ID").optional().or(z.literal("")),
  starting_qty_litres: z.coerce.number().min(0).max(10000000).optional(),
  qty_volume_mt: z.coerce.number().min(0).optional(),
  unit_price: z.coerce.number().min(0).max(1000000).optional(),
  audit_officer: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  product_officer: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  it_compliance_officer: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  security_exit_officer: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  commission_officer: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  sales_manager: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  vessel_broker: z.string().max(200).optional().or(z.literal("")),
  vessel_name: z.string().max(200).optional().or(z.literal("")),
  surveyor_name: z.string().max(200).optional().or(z.literal("")),
  surveyor_phone: z.string().max(20).optional().or(z.literal("")),
});

const updatePfiSchema = z.object({
  pfi_number: z.string().min(1).max(50).optional(),
  description: z.string().max(1000).optional().or(z.literal("")),
  pfi_date: z.string().optional().or(z.literal("")),
  status: z.enum(["active", "finished"]).optional(),
  location_id: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  product_id: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  starting_qty_litres: z.coerce.number().min(0).max(10000000).optional(),
  qty_volume_mt: z.coerce.number().min(0).optional(),
  sold_qty_litres: z.coerce.number().min(0).optional(),
  total_amount: z.coerce.number().min(0).optional(),
  unit_price: z.coerce.number().min(0).max(1000000).optional(),
  audit_officer: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  product_officer: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  it_compliance_officer: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  security_exit_officer: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  commission_officer: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  sales_manager: z.string().regex(objectIdRegex).optional().or(z.literal("")),
  vessel_broker: z.string().max(200).optional().or(z.literal("")),
  vessel_name: z.string().max(200).optional().or(z.literal("")),
  surveyor_name: z.string().max(200).optional().or(z.literal("")),
  surveyor_phone: z.string().max(20).optional().or(z.literal("")),
  closure_date: z.string().optional().or(z.literal("")),
  total_inflow: z.coerce.number().min(0).optional(),
  closure_bank: z.string().max(200).optional().or(z.literal("")),
  purchase_cost: z.coerce.number().min(0).optional(),
  aggregate_expenses: z.coerce.number().min(0).optional(),
  closure_handler: z.string().max(200).optional().or(z.literal("")),
  closure_remarks: z.string().max(1000).optional().or(z.literal("")),
});

const pfiQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(100),
  search: z.string().max(100).optional(),
  status: z.enum(["active", "finished", "all"]).optional(),
  location: z.string().regex(objectIdRegex).optional(),
  product: z.string().regex(objectIdRegex).optional(),
});

const pfiIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, "Invalid PFI ID"),
});

module.exports = {
  createPfiSchema,
  updatePfiSchema,
  pfiQuerySchema,
  pfiIdParamSchema,
};
