const { bigint, varchar, text, boolean, integer, timestamp } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { consumerLpgplant } = require("../consumerLpgplant");

// consumer_lpgplant (the live row, canonical) has no address fields and no
// Paystack subaccount fields — this table holds exactly those, 1:1 keyed to
// the live plant.
const lpgStationExtras = smanSchema.table("lpg_station_extras", {
  lpgStationId: bigint("lpg_station_id", { mode: "number" })
    .primaryKey()
    .references(() => consumerLpgplant.id, { onDelete: "cascade" }),
  address: text("address").default(""),
  city: varchar("city", { length: 100 }).default(""),
  state: varchar("state", { length: 100 }).default(""),
  country: varchar("country", { length: 100 }).default(""),
  postcode: varchar("postcode", { length: 20 }).default(""),
  establishedYear: varchar("established_year", { length: 10 }).default(""),
  paystackSubaccountCode: varchar("paystack_subaccount_code", { length: 100 }).default(""),
  subaccountActive: boolean("subaccount_active").default(false).notNull(),
  subaccountSplitPercentage: integer("subaccount_split_percentage").default(100).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

module.exports = { lpgStationExtras };
