const { bigint, serial, text, decimal, timestamp, index, uniqueIndex, check } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema, walletHoldStatusEnum } = require("./enums");
const { consumerCustomer } = require("../consumerCustomer");
const { consumerOrder } = require("../consumerOrder");
// "deposits" maps to consumer_orderpaymentrecord on the live schema
// (docs/LIVE_DB_CUTOVER.md §3, low confidence — verify before relying on it).
const { consumerOrderpaymentrecord } = require("../consumerOrderpaymentrecord");

// A hold is money committed to an order but not yet spent. Placing one
// decrements the customer's balance so the funds cannot be double-spent; the
// ledger row in consumer_orderpaymentrecord is written only when the hold
// converts. The invariant, checkable at any time:
//
//   balance = sum(credits) - sum(debits) - sum(active holds)
//
// Cancelling an order releases its hold (balance restored, no ledger noise);
// completing it converts the hold into a debit payment-record row.
//
// NOTE: consumer_customer has no balance/wallet column on the live schema
// (docs/LIVE_DB_CUTOVER.md §3) — the balance side of this invariant has no
// backing column until that gap is resolved. Flagged, not silently stubbed.
const walletHolds = smanSchema.table(
  "wallet_holds",
  {
    id: serial("id").primaryKey(),
    customerId: bigint("customer_id", { mode: "number" })
      .notNull()
      .references(() => consumerCustomer.id, { onDelete: "restrict" }),
    orderId: bigint("order_id", { mode: "number" })
      .notNull()
      .references(() => consumerOrder.id, { onDelete: "restrict" }),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    status: walletHoldStatusEnum("status").default("active").notNull(),
    description: text("description").default(""),
    // The debit payment-record row created when this hold converted.
    depositId: bigint("deposit_id", { mode: "number" }).references(() => consumerOrderpaymentrecord.id, {
      onDelete: "set null",
    }),
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
