const { pgTable, serial, integer, decimal, timestamp, index, uniqueIndex } = require("drizzle-orm/pg-core");
const { orders } = require("./order");
const { deposits } = require("./deposit");

/**
 * Which credit deposit(s) paid for which order, and how much of each.
 *
 * Written by walletService.allocateOrderFunding() the moment an order's hold
 * is placed, reversed by deallocateOrderFunding() if the hold is released.
 * Purely additive bookkeeping alongside the real balance debit — a row here
 * is never the source of truth for whether an order is paid, only a record
 * of where the money is understood to have come from.
 */
const orderDepositAllocations = pgTable(
  "order_deposit_allocations",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    depositId: integer("deposit_id")
      .notNull()
      .references(() => deposits.id, { onDelete: "restrict" }),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("order_deposit_allocations_order_deposit_idx").on(table.orderId, table.depositId),
    index("order_deposit_allocations_deposit_idx").on(table.depositId),
  ]
);

module.exports = { orderDepositAllocations };
