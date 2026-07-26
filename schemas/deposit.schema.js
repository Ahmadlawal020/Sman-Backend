const z = require("zod");
const { id, money, nonEmptyString, optionalString, pagination } = require("./fields");

/**
 * `amount` must be strictly positive: a zero-value ledger entry is noise, and
 * a negative one is a debit wearing a credit's clothing. Direction belongs in
 * `type`, not in the sign.
 */
const createDeposit = z.object({
  customer: id,
  amount: money({ min: 0.01 }),
  type: z.enum(["credit", "debit"]),
  description: optionalString(500),
  reference: optionalString(100),
});

const syncPaystack = z.object({
  reference: nonEmptyString(100),
});

const listDeposits = pagination.extend({
  search: z.string().trim().max(200).optional(),
  type: z.enum(["credit", "debit"]).optional(),
  customer: id.optional(),
});

const idParam = z.object({ id });

module.exports = { createDeposit, syncPaystack, listDeposits, idParam };
