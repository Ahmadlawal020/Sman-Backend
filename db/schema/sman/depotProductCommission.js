const { bigint, serial, decimal, timestamp, index, uniqueIndex, check } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema } = require("./enums");
const { consumerDepots } = require("../consumerDepots");
const { consumerProduct } = require("../consumerProduct");

// No live counterpart — consumer_locationcommissionrate is tiered by total
// amount (below 500k / 500k-1m / above 1m), not per depot+product.
const depotProductCommissions = smanSchema.table(
  "depot_product_commissions",
  {
    id: serial("id").primaryKey(),
    depotId: bigint("depot_id", { mode: "number" })
      .notNull()
      .references(() => consumerDepots.id, { onDelete: "cascade" }),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => consumerProduct.id, { onDelete: "cascade" }),
    commissionRate: decimal("commission_rate", { precision: 15, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("depot_product_commission_unique_idx").on(table.depotId, table.productId),
    index("depot_product_commission_depot_idx").on(table.depotId),
    check("depot_product_commission_rate_check", sql`${table.commissionRate} >= 0`),
  ]
);

module.exports = { depotProductCommissions };
