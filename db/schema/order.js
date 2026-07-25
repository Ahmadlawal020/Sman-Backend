const {
  pgTable,
  serial,
  varchar,
  integer,
  decimal,
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("orders_order_number_idx").on(table.orderNumber),
    index("orders_customer_payment_created_idx").on(table.customerId, table.paymentStatus, table.createdAt),
    index("orders_virtual_account_payment_idx").on(table.virtualAccountNumber, table.paymentStatus),
    index("orders_status_idx").on(table.status),
    check("orders_quantity_check", sql`${table.quantity} > 0`),
    check("orders_price_check", sql`${table.price} >= 0`),
    check("orders_total_check", sql`${table.totalAmount} >= 0`),
  ]
);

module.exports = { orders };
