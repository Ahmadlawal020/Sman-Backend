const { bigint, varchar, text, integer, boolean, timestamp, check } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema } = require("./enums");
const { consumerDepots } = require("../consumerDepots");

// consumer_depots (the live row, canonical) is just id/name/location — no
// code, address, capacity, status, established_year, or Paystack subaccount
// fields at all. Kept exactly as the old `depots` table had them, 1:1 keyed
// to the live depot.
const depotExtras = smanSchema.table(
  "depot_extras",
  {
    depotId: bigint("depot_id", { mode: "number" })
      .primaryKey()
      .references(() => consumerDepots.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 50 }),
    address: text("address").default(""),
    city: varchar("city", { length: 100 }).default(""),
    state: varchar("state", { length: 100 }).default(""),
    country: varchar("country", { length: 100 }).default(""),
    postcode: varchar("postcode", { length: 20 }).default(""),
    parkedTrucksCount: integer("parked_trucks_count").default(0).notNull(),
    maxCapacity: integer("max_capacity"),
    status: varchar("status", { length: 20 }).default("Active").notNull(),
    establishedYear: varchar("established_year", { length: 10 }).default(""),
    paystackSubaccountCode: varchar("paystack_subaccount_code", { length: 100 }).default(""),
    subaccountActive: boolean("subaccount_active").default(false).notNull(),
    subaccountSplitPercentage: integer("subaccount_split_percentage").default(100).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("depot_extras_parked_trucks_check", sql`${table.parkedTrucksCount} >= 0`)]
);

module.exports = { depotExtras };
