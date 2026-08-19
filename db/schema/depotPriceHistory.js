const {
  pgTable,
  serial,
  integer,
  decimal,
  timestamp,
  index,
} = require("drizzle-orm/pg-core");
const { depotProductPrices } = require("./depotProductPrices");

const depotPriceHistory = pgTable(
  "depot_price_history",
  {
    id: serial("id").primaryKey(),
    depotProductPriceId: integer("depot_product_price_id")
      .notNull()
      .references(() => depotProductPrices.id, { onDelete: "cascade" }),
    price: decimal("price", { precision: 15, scale: 2 }).notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("depot_price_history_parent_idx").on(table.depotProductPriceId),
  ]
);

module.exports = { depotPriceHistory };
