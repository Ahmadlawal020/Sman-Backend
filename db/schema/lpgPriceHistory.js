const {
  pgTable,
  serial,
  integer,
  decimal,
  timestamp,
  index,
} = require("drizzle-orm/pg-core");
const { lpgStations } = require("./lpgStation");

const lpgPriceHistory = pgTable(
  "lpg_price_history",
  {
    id: serial("id").primaryKey(),
    lpgStationId: integer("lpg_station_id")
      .notNull()
      .references(() => lpgStations.id, { onDelete: "cascade" }),
    pricePerKg: decimal("price_per_kg", { precision: 15, scale: 2 }).notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("lpg_price_history_station_idx").on(table.lpgStationId),
  ]
);

module.exports = { lpgPriceHistory };
