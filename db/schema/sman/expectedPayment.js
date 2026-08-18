const { bigint, serial, decimal, varchar, text, timestamp, index } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { consumerCustomer } = require("../consumerCustomer");
const { consumerOrder } = require("../consumerOrder");
const { consumerDepots } = require("../consumerDepots");
const { consumerPfi } = require("../consumerPfi");
const { consumerOrderpaymentrecord } = require("../consumerOrderpaymentrecord");
const { administrationUser } = require("../administrationUser");

// No live counterpart — nothing in soroman_db tracks an advisory "expected"
// payment before it arrives; consumer_orderpaymentinfo/orderpaymentrecord are
// about payments that already happened.
const expectedPayments = smanSchema.table(
  "expected_payments",
  {
    id: serial("id").primaryKey(),
    customerId: bigint("customer_id", { mode: "number" })
      .notNull()
      .references(() => consumerCustomer.id, { onDelete: "cascade" }),
    orderId: bigint("order_id", { mode: "number" }).references(() => consumerOrder.id, { onDelete: "set null" }),
    depotId: bigint("depot_id", { mode: "number" }).references(() => consumerDepots.id, { onDelete: "set null" }),
    pfiId: bigint("pfi_id", { mode: "number" }).references(() => consumerPfi.id, { onDelete: "set null" }),
    expectedAmount: decimal("expected_amount", { precision: 15, scale: 2 }),
    reference: varchar("reference", { length: 255 }).default(""),
    note: text("note").default(""),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    matchedDepositId: bigint("matched_deposit_id", { mode: "number" }).references(
      () => consumerOrderpaymentrecord.id,
      { onDelete: "set null" }
    ),
    createdBy: bigint("created_by", { mode: "number" }).references(() => administrationUser.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("expected_payments_customer_status_idx").on(table.customerId, table.status),
    index("expected_payments_order_idx").on(table.orderId),
  ]
);

module.exports = { expectedPayments };
