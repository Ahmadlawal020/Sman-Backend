const {
  pgTable,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { depots } = require("./depot");
const { products } = require("./product");

const depotProductCapacities = pgTable(
  "depot_product_capacities",
  {
    id: serial("id").primaryKey(),
    depotId: integer("depot_id")
      .notNull()
      .references(() => depots.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
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
