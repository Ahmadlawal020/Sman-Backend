const { bigint, serial, integer, decimal, timestamp, index, check } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema, commissionStatusEnum } = require("./enums");
const { consumerOrder } = require("../consumerOrder");
const { consumerCustomer } = require("../consumerCustomer");
const { consumerDepots } = require("../consumerDepots");
const { consumerProduct } = require("../consumerProduct");
const { administrationUser } = require("../administrationUser");

// No live counterpart as a distinct table — Django denormalises commission
// onto consumer_order directly (commission_amount, commission_paid_at,
// commission_paid_by_id, commission_account_*) plus a rate table tiered by
// total amount (consumer_locationcommissionrate), not by depot+product. Kept
// as its own table, FK'd to the live rows, pending a repository-level
// decision on how it reconciles with consumer_order's inline fields.
const commissions = smanSchema.table(
  "commissions",
  {
    id: serial("id").primaryKey(),
    orderId: bigint("order_id", { mode: "number" })
      .notNull()
      .references(() => consumerOrder.id, { onDelete: "restrict" }),
    customerId: bigint("customer_id", { mode: "number" })
      .notNull()
      .references(() => consumerCustomer.id, { onDelete: "restrict" }),
    depotId: bigint("depot_id", { mode: "number" })
      .notNull()
      .references(() => consumerDepots.id, { onDelete: "restrict" }),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => consumerProduct.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    commissionRate: decimal("commission_rate", { precision: 15, scale: 2 }).notNull(),
    commissionAmount: decimal("commission_amount", { precision: 15, scale: 2 }).notNull(),
    status: commissionStatusEnum("status").default("pending").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidBy: bigint("paid_by", { mode: "number" }).references(() => administrationUser.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("commissions_order_idx").on(table.orderId),
    index("commissions_customer_idx").on(table.customerId),
    index("commissions_status_idx").on(table.status),
    index("commissions_depot_product_idx").on(table.depotId, table.productId),
    check("commissions_quantity_check", sql`${table.quantity} > 0`),
    check("commissions_rate_check", sql`${table.commissionRate} >= 0`),
    check("commissions_amount_check", sql`${table.commissionAmount} >= 0`),
  ]
);

module.exports = { commissions };
