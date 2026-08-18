const { bigint, serial, decimal, timestamp, index } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { consumerLpgplant } = require("../consumerLpgplant");

// consumer_lpgplant only ever holds the CURRENT price_per_kg — no history
// table lives there, matching the same gap as depot_price_history.
const lpgPriceHistory = smanSchema.table(
  "lpg_price_history",
  {
    id: serial("id").primaryKey(),
    lpgStationId: bigint("lpg_station_id", { mode: "number" })
      .notNull()
      .references(() => consumerLpgplant.id, { onDelete: "cascade" }),
    pricePerKg: decimal("price_per_kg", { precision: 15, scale: 2 }).notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("lpg_price_history_station_idx").on(table.lpgStationId)]
);

module.exports = { lpgPriceHistory };
