const {
  pgTable,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} = require("drizzle-orm/pg-core");
const { pfis } = require("./pfi");
const { orders } = require("./order");

/**
 * Quantity allocated to a PFI outside the pickup-release path — the delivery
 * side of the business.
 *
 * This table already existed in production before it existed here: it was
 * created by a migration that was never committed, so nothing in the schema or
 * the code knew about it. Declaring it closes that gap, and `pfiFinance` counts
 * it toward the sold figure alongside the movement ledger, which is what the
 * stock balance is supposed to mean.
 */
const orderPfiAllocations = pgTable(
  "order_pfi_allocations",
  {
    id: serial("id").primaryKey(),
    // Shapes below mirror what production already has — this table is older
    // than this file, so the live schema is the authority, not the reverse.
    orderId: integer("order_id").references(() => orders.id, { onDelete: "cascade" }).notNull(),
    pfiId: integer("pfi_id").references(() => pfis.id, { onDelete: "cascade" }).notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("opa_order_idx").on(table.orderId),
    index("opa_pfi_idx").on(table.pfiId),
    // The one addition: one allocation per order per PFI, the same guard the
    // movement ledger uses so a retry cannot deduct stock twice. Safe to add —
    // the table is empty.
    uniqueIndex("order_pfi_allocations_order_pfi_idx").on(table.orderId, table.pfiId),
  ]
);

module.exports = { orderPfiAllocations };
