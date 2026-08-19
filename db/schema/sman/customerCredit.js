const { bigint, serial, decimal, varchar, text, timestamp, index, uniqueIndex } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema } = require("./enums");
const { consumerCustomer } = require("../consumerCustomer");
const { consumerOrder } = require("../consumerOrder");
const { consumerOrderpaymentrecord } = require("../consumerOrderpaymentrecord");
const { administrationUser } = require("../administrationUser");

/**
 * Pre-order credit ledger. consumer_orderpaymentrecord.order_id is NOT NULL
 * on the live schema — Django has nowhere to record money received before an
 * order exists — so a customer's spendable balance is:
 *
 *   SUM(sman.customer_credits.amount) - SUM(active sman.wallet_holds.amount)
 *
 * Signed entries: positive = money received (deposit, overpayment carried
 * forward), negative = applied to an order. Applying credit to an order MUST
 * pair a negative entry here with a real consumer_orderpaymentrecord insert
 * for that order (orderId set) — that's what keeps Django's per-order ledger
 * correct once the order exists. A standalone deposit (orderId null) is
 * float that hasn't been applied to anything yet.
 */
const customerCredits = smanSchema.table(
  "customer_credits",
  {
    id: serial("id").primaryKey(),
    customerId: bigint("customer_id", { mode: "number" })
      .notNull()
      .references(() => consumerCustomer.id, { onDelete: "restrict" }),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    // Set when this entry represents credit applied to (or refunded from) a
    // specific order — null for a standalone deposit not yet applied.
    orderId: bigint("order_id", { mode: "number" }).references(() => consumerOrder.id, { onDelete: "set null" }),
    // The consumer_orderpaymentrecord row this entry produced, once applied.
    paymentRecordId: bigint("payment_record_id", { mode: "number" }).references(
      () => consumerOrderpaymentrecord.id,
      { onDelete: "set null" }
    ),
    description: varchar("description", { length: 255 }).default(""),
    reference: varchar("reference", { length: 255 }).default(""),
    notes: text("notes").default(""),
    createdBy: bigint("created_by", { mode: "number" }).references(() => administrationUser.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("customer_credits_customer_idx").on(table.customerId, table.createdAt),
    index("customer_credits_order_idx").on(table.orderId),
    // wallet.service.credit()'s duplicate-reference guard catches a unique
    // violation on reference — this index is what makes that guard real.
    // Without it two racing credits with the same reference BOTH insert
    // (double-credit). Partial: empty references (the default) are not
    // deposits with an external ref and must never collide with each other.
    uniqueIndex("customer_credits_reference_uniq")
      .on(table.reference)
      .where(sql`reference <> ''`),
  ]
);

module.exports = { customerCredits };
