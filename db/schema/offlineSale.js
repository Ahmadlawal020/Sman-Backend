const {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  decimal,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { offlineSaleStatusEnum, orderPaymentStatusEnum } = require("./enums");
const { staff } = require("./staff");
const { products } = require("./product");

// Sales recorded outside the ordering flow (walk-ins, phone sales, manual
// depot sales). Line items snapshot their unit price at entry — totals never
// depend on the current price list. Approval and reconciliation make these
// auditable instead of a spreadsheet on someone's laptop.
const offlineSales = pgTable(
  "offline_sales",
  {
    id: serial("id").primaryKey(),
    saleNumber: varchar("sale_number", { length: 50 }).notNull(),
    state: varchar("state", { length: 100 }).default(""),
    location: varchar("location", { length: 255 }).default(""),

    customerName: varchar("customer_name", { length: 255 }).default(""),
    customerPhone: varchar("customer_phone", { length: 50 }).default(""),

    // Generated in Postgres would be ideal, but line items live in another
    // table; the service recomputes this inside the same transaction that
    // writes the items.
    totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).default("0").notNull(),
    amountPaid: decimal("amount_paid", { precision: 15, scale: 2 }).default("0").notNull(),
    paymentStatus: orderPaymentStatusEnum("payment_status").default("Unpaid").notNull(),
    paymentBank: varchar("payment_bank", { length: 255 }).default(""),
    paymentReference: varchar("payment_reference", { length: 255 }).default(""),

    status: offlineSaleStatusEnum("status").default("pending").notNull(),
    approvedBy: integer("approved_by").references(() => staff.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason").default(""),

    reconciled: boolean("reconciled").default(false).notNull(),
    reconciledBy: integer("reconciled_by").references(() => staff.id, { onDelete: "set null" }),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),

    notes: text("notes").default(""),
    createdBy: integer("created_by").references(() => staff.id, { onDelete: "set null" }),
    createdByName: varchar("created_by_name", { length: 255 }).default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("offline_sales_number_idx").on(table.saleNumber),
    index("offline_sales_status_idx").on(table.status),
    index("offline_sales_created_idx").on(table.createdAt),
    check("offline_sales_amounts_check", sql`${table.totalAmount} >= 0 AND ${table.amountPaid} >= 0`),
  ]
);

const offlineSaleItems = pgTable(
  "offline_sale_items",
  {
    id: serial("id").primaryKey(),
    offlineSaleId: integer("offline_sale_id")
      .notNull()
      .references(() => offlineSales.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    // Price snapshot at entry time — deliberately not a live lookup.
    unitPrice: decimal("unit_price", { precision: 15, scale: 2 }).notNull(),
    lineTotal: decimal("line_total", { precision: 15, scale: 2 }).notNull(),
  },
  (table) => [
    uniqueIndex("offline_sale_items_sale_product_idx").on(table.offlineSaleId, table.productId),
    check("offline_sale_items_quantity_check", sql`${table.quantity} > 0`),
    check("offline_sale_items_price_check", sql`${table.unitPrice} >= 0`),
  ]
);

module.exports = { offlineSales, offlineSaleItems };
