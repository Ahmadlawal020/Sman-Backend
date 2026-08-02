const {
  pgTable,
  serial,
  integer,
  timestamp,
  index,
} = require("drizzle-orm/pg-core");
const { orders } = require("./order");
const { pfis } = require("./pfi");

/**
 * Tracks how much of an order's quantity was drawn from each PFI.
 *
 * An order whose entire quantity fits in a single PFI gets one row. When stock
 * is spread across multiple PFIs the greedy fill creates one row per PFI used.
 * On cancel / expire every row is released individually so no stock is leaked.
 */
const orderPfiAllocations = pgTable(
  "order_pfi_allocations",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    pfiId: integer("pfi_id")
      .notNull()
      .references(() => pfis.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("opa_order_idx").on(table.orderId),
    index("opa_pfi_idx").on(table.pfiId),
  ]
);

module.exports = { orderPfiAllocations };
