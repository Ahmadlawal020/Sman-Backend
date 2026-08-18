const { bigint, serial, integer, timestamp, index, uniqueIndex, check } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema } = require("./enums");
const { consumerDepots } = require("../consumerDepots");
const { consumerProduct } = require("../consumerProduct");

const depotProductCapacities = smanSchema.table(
  "depot_product_capacities",
  {
    id: serial("id").primaryKey(),
    depotId: bigint("depot_id", { mode: "number" })
      .notNull()
      .references(() => consumerDepots.id, { onDelete: "cascade" }),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => consumerProduct.id, { onDelete: "cascade" }),
    capacity: integer("capacity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("depot_product_cap_unique_idx").on(table.depotId, table.productId),
    index("depot_product_cap_depot_idx").on(table.depotId),
    check("depot_product_cap_check", sql`${table.capacity} >= 0`),
  ]
);

module.exports = { depotProductCapacities };
