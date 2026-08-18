const { bigint, varchar, boolean, text, jsonb, timestamp } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { consumerBankacct } = require("../consumerBankacct");

// consumer_bankacct (the live row, canonical) is scoped to a single
// location_id; the old model let one account be shared across many depots
// and LPG stations via JSON arrays, plus fields consumer_bankacct doesn't
// carry at all (bank_code, branch_name, currency, is_default). Kept exactly
// as before, 1:1 keyed to the live account.
const bankAccountExtras = smanSchema.table("bank_account_extras", {
  bankAccountId: bigint("bank_account_id", { mode: "number" })
    .primaryKey()
    .references(() => consumerBankacct.id, { onDelete: "cascade" }),
  bankCode: varchar("bank_code", { length: 50 }).default(""),
  branchName: varchar("branch_name", { length: 150 }).default(""),
  currency: varchar("currency", { length: 10 }).default("NGN").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  depotIds: jsonb("depot_ids").default([]).notNull(),
  lpgStationIds: jsonb("lpg_station_ids").default([]).notNull(),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

module.exports = { bankAccountExtras };
