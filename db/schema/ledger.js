const {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  decimal,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const {
  ledgerOwnerTypeEnum,
  ledgerDirectionEnum,
  ledgerCategoryEnum,
} = require("./enums");
const { staff } = require("./staff");

// One ledger engine for every book in the business: delivery customers,
// filling stations, fleet trucks (and later commissions). An account is the
// book; entries are the immutable lines in it.
//
// Convention: debit increases what the owner owes us (a sale to a customer,
// an expense on a truck); credit decreases it (a payment received, income
// earned). runningBalance = debits - credits = outstanding.
const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: serial("id").primaryKey(),
    ownerType: ledgerOwnerTypeEnum("owner_type").notNull(),
    ownerId: integer("owner_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
    // Cached view of the entry stream, maintained under the same row lock
    // that serialises postings. Recomputable: sum(debits) - sum(credits).
    runningBalance: decimal("running_balance", { precision: 15, scale: 2 }).default("0").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One book per owner, ever.
    uniqueIndex("ledger_accounts_owner_idx").on(table.ownerType, table.ownerId),
  ]
);

const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    direction: ledgerDirectionEnum("direction").notNull(),
    category: ledgerCategoryEnum("category").notNull(),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    description: text("description").default(""),
    // External idempotency key (bank ref, upload row id). Unique when set.
    reference: varchar("reference", { length: 255 }).default(""),
    // Business date of the movement, distinct from when it was recorded.
    entryDate: date("entry_date").notNull(),
    balanceAfter: decimal("balance_after", { precision: 15, scale: 2 }).notNull(),
    metadata: jsonb("metadata"),
    recordedBy: integer("recorded_by").references(() => staff.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ledger_entries_account_created_idx").on(table.accountId, table.createdAt),
    index("ledger_entries_account_date_idx").on(table.accountId, table.entryDate),
    index("ledger_entries_category_idx").on(table.category),
    uniqueIndex("ledger_entries_reference_idx")
      .on(table.reference)
      .where(sql`${table.reference} IS NOT NULL AND ${table.reference} != ''`),
    check("ledger_entries_amount_check", sql`${table.amount} > 0`),
  ]
);

module.exports = { ledgerAccounts, ledgerEntries };
