/**
 * The expense chart of accounts, as the UI needs to see it.
 *
 * The accounts themselves live in `expense_categories` (seeded by migration
 * 0045) — this file only holds what cannot go in a table: the order the groups
 * are offered in, their labels, and which of them may be booked to.
 */

/** Group codes, in the order the first dropdown offers them. */
const GL_GROUPS = [
  {
    code: "pfi_direct",
    label: "PFI / Product Related Costs",
    hint: "Booked to a cargo batch and rolled into its cost.",
    /** The only group that may name a PFI — and it must. */
    requiresPfi: true,
  },
  {
    code: "administrative",
    label: "Administrative Expenses",
    hint: "General cost of running the company.",
  },
  {
    code: "depot",
    label: "Depot / Warehouse Expenses",
    hint: "Depot and warehouse operations.",
  },
  {
    code: "sales_distribution",
    label: "Sales & Distribution Expenses",
    hint: "Getting product to market.",
  },
  {
    code: "income",
    label: "Income / Other Receipts",
    hint: "Money coming in. Not an expense.",
    /** Seeded for a complete chart; refused on the expense path. */
    isIncome: true,
  },
];

const GROUP_BY_CODE = new Map(GL_GROUPS.map((g) => [g.code, g]));

/** Everything but income. What the expense form is allowed to offer. */
const EXPENSE_GROUPS = GL_GROUPS.filter((g) => !g.isIncome);

const groupFor = (code) => GROUP_BY_CODE.get(code) || null;

/** Nigerian standard rate, applied to the ex-VAT figure on the form. */
const VAT_RATE = 0.075;

/**
 * The withholding rates the form offers, as percentages.
 *
 * Deliberately unlabelled by transaction type. Which rate a given invoice
 * attracts is a judgement Finance makes — printing "5% — professional fees"
 * beside the option would be this app quietly giving tax advice, and would be
 * wrong the moment the schedule changes. Anything not on the list is entered as
 * a plain amount instead.
 *
 * WHT is computed on the ex-VAT value, never on the VAT-inclusive total.
 */
const WHT_RATES = [0, 2, 2.5, 5, 10];

module.exports = { GL_GROUPS, EXPENSE_GROUPS, groupFor, VAT_RATE, WHT_RATES };
