const {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { depotStatusEnum } = require("./enums");

const depots = pgTable(
  "depots",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 50 }).notNull(),
    address: text("address").notNull(),
    city: varchar("city", { length: 100 }).notNull(),
    state: varchar("state", { length: 100 }).notNull(),
    country: varchar("country", { length: 100 }).notNull(),
    postcode: varchar("postcode", { length: 20 }).notNull(),
    parkedTrucksCount: integer("parked_trucks_count").default(0).notNull(),
    maxCapacity: integer("max_capacity").notNull(),
    status: depotStatusEnum("status").default("Active").notNull(),
    establishedYear: varchar("established_year", { length: 10 }).notNull(),
    paystackSubaccountCode: varchar("paystack_subaccount_code", { length: 100 }).default(""),
    subaccountActive: boolean("subaccount_active").default(false).notNull(),
    subaccountSplitPercentage: integer("subaccount_split_percentage").default(100).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("depots_code_idx").on(table.code),
    check("depots_max_capacity_check", sql`${table.maxCapacity} >= 1`),
    check("depots_parked_trucks_check", sql`${table.parkedTrucksCount} >= 0`),
  ]
);

module.exports = { depots };
