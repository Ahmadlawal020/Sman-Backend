const { bigint, serial, decimal, timestamp, index, uniqueIndex } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { consumerOrder } = require("../consumerOrder");
const { consumerOrderpaymentrecord } = require("../consumerOrderpaymentrecord");

// No confident live counterpart — consumer_paymentsplit is structurally
// different (no deposit_id) and wasn't treated as equivalent. Kept as a
// standalone bookkeeping table, FK'd to the live order/payment-record rows.
const orderDepositAllocations = smanSchema.table(
  "order_deposit_allocations",
  {
    id: serial("id").primaryKey(),
    orderId: bigint("order_id", { mode: "number" })
      .notNull()
      .references(() => consumerOrder.id, { onDelete: "cascade" }),
    depositId: bigint("deposit_id", { mode: "number" })
      .notNull()
      .references(() => consumerOrderpaymentrecord.id, { onDelete: "restrict" }),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("order_deposit_allocations_order_deposit_idx").on(table.orderId, table.depositId),
    index("order_deposit_allocations_deposit_idx").on(table.depositId),
  ]
);

module.exports = { orderDepositAllocations };
