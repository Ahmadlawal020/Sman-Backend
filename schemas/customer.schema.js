const { z } = require("zod");
const { id, money, nonEmptyString, optionalString, pagination } = require("./fields");

/**
 * Replaces a Mongo-era schema that validated ids with an ObjectId regex
 * (/^[0-9a-fA-F]{24}$/) — against a Postgres serial column, that would have
 * rejected every request had it ever been wired up.
 *
 * Phone is checked for presence only; `toE164` in the controller does the real
 * parsing, because valid-phone-ness is a libphonenumber question, not a regex
 * one, and duplicating it here would create a second source of truth.
 */
const createCustomer = z.object({
  name: nonEmptyString(255),
  phone: nonEmptyString(30),
  email: z.string().trim().max(255).email().optional().or(z.literal("")),
  companyName: optionalString(255),
  address: optionalString(1000),
  status: z.enum(["Active", "Inactive", "Pending"]).optional(),
  balance: money().optional(),
  deposit: money().optional(),
  previousDeposit: money().optional(),
});

/**
 * Update is the same shape with everything optional — and, importantly, still
 * a whitelist. `virtualAccountNumber` is absent on purpose: overwriting it
 * would redirect another customer's incoming payments, since the webhook
 * matches on account number.
 */
const updateCustomer = createCustomer.partial();

const listCustomers = pagination.extend({
  search: z.string().trim().max(200).optional(),
  searchType: z.enum(["name", "email", "phone", "companyName"]).optional(),
  status: z.enum(["Active", "Inactive", "Pending", "all"]).optional(),
});

const idParam = z.object({ id });

module.exports = { createCustomer, updateCustomer, listCustomers, idParam };
