const {
  pgTable,
  serial,
  text,
  integer,
  decimal,
  timestamp,
  index,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { walletHoldStatusEnum } = require("./enums");
const { customers } = require("./customer");
const { orders } = require("./order");
const { deposits } = require("./deposit");

// A hold is money committed to an order but not yet spent. Placing one
// decrements customers.balance so the funds cannot be double-spent; the
// ledger row in deposits is written only when the hold converts. The
// invariant, checkable at any time:
//
//   balance = sum(credits) - sum(debits) - sum(active holds)
//
// Cancelling an order releases its hold (balance restored, no ledger noise);
// completing it converts the hold into a debit deposit row.
const walletHolds = pgTable(
  "wallet_holds",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    status: walletHoldStatusEnum("status").default("active").notNull(),
    description: text("description").default(""),
    // The debit deposit row created when this hold converted.
    depositId: integer("deposit_id").references(() => deposits.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    // One hold per order, ever. Re-attempts hit the conflict instead of
    // holding the same money twice.
    uniqueIndex("wallet_holds_order_idx").on(table.orderId),
    index("wallet_holds_customer_status_idx").on(table.customerId, table.status),
    check("wallet_holds_amount_check", sql`${table.amount} > 0`),
  ]
);

module.exports = { walletHolds };
