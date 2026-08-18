const { bigint, serial, decimal, timestamp, index } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
// depot_product_prices maps to consumer_productprice on the live schema
// (docs/LIVE_DB_CUTOVER.md §3, medium confidence).
const { consumerProductprice } = require("../consumerProductprice");

const depotPriceHistory = smanSchema.table(
  "depot_price_history",
  {
    id: serial("id").primaryKey(),
    depotProductPriceId: bigint("depot_product_price_id", { mode: "number" })
      .notNull()
      .references(() => consumerProductprice.id, { onDelete: "cascade" }),
    price: decimal("price", { precision: 15, scale: 2 }).notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("depot_price_history_parent_idx").on(table.depotProductPriceId)]
);

module.exports = { depotPriceHistory };
