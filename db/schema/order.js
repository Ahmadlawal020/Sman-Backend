const {
  pgTable,
  serial,
  varchar,
  integer,
  decimal,
  text,
  timestamp,
  index,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const {
  orderDeliveryTypeEnum,
  orderPaymentStatusEnum,
  orderStatusEnum,
} = require("./enums");
const { customers } = require("./customer");
const { depots } = require("./depot");
const { products } = require("./product");
const { staff } = require("./staff");
const { pfis } = require("./pfi");

const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    orderNumber: varchar("order_number", { length: 50 }).notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    state: varchar("state", { length: 100 }).notNull(),
    depotId: integer("depot_id")
      .notNull()
      .references(() => depots.id, { onDelete: "restrict" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    price: decimal("price", { precision: 15, scale: 2 }).notNull(),
    totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
    deliveryType: orderDeliveryTypeEnum("delivery_type").notNull(),
    pfiId: integer("pfi_id").references(() => pfis.id, { onDelete: "set null" }),
    virtualAccountNumber: varchar("virtual_account_number", { length: 30 }).default(""),
    virtualAccountBank: varchar("virtual_account_bank", { length: 100 }).default(""),
    virtualAccountName: varchar("virtual_account_name", { length: 255 }).default(""),
    paymentStatus: orderPaymentStatusEnum("payment_status").default("Unpaid").notNull(),
    status: orderStatusEnum("status").default("Pending").notNull(),

    // Accountability per stage. These columns — not audit_logs — are the source
    // for customer tracking; the audit log is the system-wide trail. A stage
    // reached at most once, so one timestamp per stage is lossless.
    // payment_confirmed_by is normally null: the webhook (actor_type=system)
    // confirms payment, not a person.
    paymentConfirmedAt: timestamp("payment_confirmed_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: integer("released_by").references(() => staff.id, { onDelete: "set null" }),
    // Stamped when the FIRST truck gates in — the order enters Loading.
    loadingStartedAt: timestamp("loading_started_at", { withTimezone: true }),
    // Stamped when the LAST truck exits — the fuel has physically left.
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: integer("cancelled_by").references(() => staff.id, { onDelete: "set null" }),
    cancellationReason: text("cancellation_reason"),

    // Supplied by callers whose requests can be redelivered (the WhatsApp
    // CONFIRM step passes the message's wamid). A second placeOrder with the
    // same key returns the original order instead of creating a duplicate.
    idempotencyKey: varchar("idempotency_key", { length: 128 }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("orders_order_number_idx").on(table.orderNumber),
    uniqueIndex("orders_idempotency_key_idx")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    index("orders_customer_payment_created_idx").on(table.customerId, table.paymentStatus, table.createdAt),
    index("orders_virtual_account_payment_idx").on(table.virtualAccountNumber, table.paymentStatus),
    index("orders_status_idx").on(table.status),
    check("orders_quantity_check", sql`${table.quantity} > 0`),
    check("orders_price_check", sql`${table.price} >= 0`),
    check("orders_total_check", sql`${table.totalAmount} >= 0`),
  ]
);

module.exports = { orders };
