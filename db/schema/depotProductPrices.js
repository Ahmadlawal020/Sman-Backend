const {
  pgTable,
  serial,
  integer,
  decimal,
  timestamp,
  index,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { depots } = require("./depot");
const { products } = require("./product");

const depotProductPrices = pgTable(
  "depot_product_prices",
  {
    id: serial("id").primaryKey(),
    depotId: integer("depot_id")
      .notNull()
      .references(() => depots.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    currentPrice: decimal("current_price", { precision: 15, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("depot_product_price_unique_idx").on(table.depotId, table.productId),
    index("depot_product_price_depot_idx").on(table.depotId),
    check("depot_product_price_check", sql`${table.currentPrice} >= 0`),
  ]
);

module.exports = { depotProductPrices };
