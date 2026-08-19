const {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  decimal,
  timestamp,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { depotStatusEnum } = require("./enums");

const lpgStations = pgTable(
  "lpg_stations",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 50 }).notNull(),
    address: text("address").notNull(),
    city: varchar("city", { length: 100 }).notNull(),
    state: varchar("state", { length: 100 }).notNull(),
    country: varchar("country", { length: 100 }).notNull(),
    postcode: varchar("postcode", { length: 20 }).notNull(),
    lpgCapacityKg: integer("lpg_capacity_kg").notNull(),
    pricePerKg: decimal("price_per_kg", { precision: 15, scale: 2 }).notNull().default("0"),
    status: depotStatusEnum("status").default("Active").notNull(),
    establishedYear: varchar("established_year", { length: 10 }).notNull(),
    paystackSubaccountCode: varchar("paystack_subaccount_code", { length: 100 }).default(""),
    subaccountActive: boolean("subaccount_active").default(false).notNull(),
    subaccountSplitPercentage: integer("subaccount_split_percentage").default(100).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("lpg_stations_code_idx").on(table.code),
    check("lpg_stations_capacity_check", sql`${table.lpgCapacityKg} >= 1`),
  ]
);

module.exports = { lpgStations };
