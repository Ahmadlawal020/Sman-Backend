const z = require("zod");
const { id, money, requiredString, optionalString, enumOf, searchTerm, pagination } = require("./fields");

/**
 * `amount` must be strictly positive: a zero-value ledger entry is noise, and
 * a negative one is a debit wearing a credit's clothing. Direction belongs in
 * `type`, not in the sign.
 */
const createDeposit = z.object({
  customer: id("Customer"),
  amount: money("Amount", { min: 0.01 }),
  type: enumOf("Type", ["credit", "debit"]).optional().default("credit"),
  description: optionalString("Description", 500),
  reference: optionalString("Reference", 100),
  bankAccountId: z.union([id("Bank Account"), z.string()]).optional().nullable(),
  bankName: optionalString("Bank Name", 100),
  accountName: optionalString("Account Name", 100),
  accountNumber: optionalString("Account Number", 50),
  depositorName: optionalString("Depositor Name", 100),
  paymentDate: optionalString("Payment Date", 100),
  paystackDetails: z.record(z.unknown()).optional().nullable(),
});

const syncPaystack = z.object({
  reference: requiredString("Payment reference", 100),
});

const listDeposits = pagination.extend({
  search: searchTerm,
  type: enumOf("Type", ["credit", "debit"]).optional(),
  customer: id("Customer").optional(),
});

const idParam = z.object({ id: id("Deposit id") });

module.exports = { createDeposit, syncPaystack, listDeposits, idParam };
