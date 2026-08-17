const z = require("zod");
const { id, money, requiredString, optionalString, enumOf, searchTerm, pagination, typeError } = require("./fields");

/**
 * `amount` must be strictly positive: a zero-value ledger entry is noise, and
 * a negative one is a debit wearing a credit's clothing. Direction belongs in
 * `type`, not in the sign.
 */
const createDeposit = z.object({
  customer: id("Customer"),
  // Optional here, not required: the statement-line path (lineIds below)
  // recomputes each deposit's amount from the claimed line itself and never
  // reads this field — the controller is what actually enforces "amount or
  // lineIds, one of the two" for the plain-entry path.
  amount: money("Amount", { min: 0.01 }).optional(),
  type: enumOf("Type", ["credit", "debit"]).optional().default("credit"),
  description: optionalString("Description", 500),
  // The `reference` column is varchar(255) — this is the real ceiling, not
  // an arbitrary one, so it's the cap actually enforced here.
  reference: optionalString("Reference", 255),
  bankAccountId: z.union([id("Bank Account"), z.string()]).optional().nullable(),
  bankName: optionalString("Bank Name", 100),
  accountName: optionalString("Account Name", 100),
  accountNumber: optionalString("Account Number", 50),
  // Lives in paystackDetails (jsonb), not a fixed-width column, and a bulk
  // deposit's depositor name is several comma-joined names — genuinely
  // unbounded, so no .max() here.
  depositorName: z
    .string({ error: typeError("Depositor Name", "text") })
    .trim()
    .optional()
    .transform((v) => v ?? ""),
  paymentDate: optionalString("Payment Date", 100),
  paystackDetails: z.record(z.unknown()).optional().nullable(),
  // Unmatched bank-statement rows this deposit claims — see
  // wallet.service.js#creditFromStatementLines. Schemas strip unknown keys
  // by default (middleware/validate.js), so leaving this out silently
  // dropped it from every request; the statement-line picker in the UI
  // never actually reached the controller's lineIds branch.
  lineIds: z.array(id("Statement line")).optional(),
});

const syncPaystack = z.object({
  reference: requiredString("Payment reference", 100),
});

const listDeposits = pagination.extend({
  search: searchTerm,
  type: enumOf("Type", ["credit", "debit"]).optional(),
  customer: id("Customer").optional(),
  // For the My Report "Total Inflow" auto-fill — deposits unambiguously
  // attributed to one PFI (see the depositRepo.findAll comment on why most
  // rows are null here).
  pfiId: id("PFI").optional(),
});

const idParam = z.object({ id: id("Deposit id") });

module.exports = { createDeposit, syncPaystack, listDeposits, idParam };
