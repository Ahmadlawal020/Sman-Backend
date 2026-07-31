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
const { customers } = require("./customer");
const { staff } = require("./staff");
const { products } = require("./product");
const { dangoteDeliveryStatusEnum } = require("./enums");

// Refinery-sourced deliveries — deliberately NOT the depot `orders` table.
// One row owns the entire lifecycle: customer quote request (draft → docs →
// agreement → under review), staff quote, payment, and Soroman-truck
// fulfilment. Depot concepts (depot_id, PFI, capacity, order_trucks) never
// apply here. Documents / agreement / events / trucks are child tables.
const dangoteDeliveryOrders = pgTable(
  "dangote_delivery_orders",
  {
    id: serial("id").primaryKey(),
    requestNumber: varchar("request_number", { length: 50 }).notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),

    // FK into the shared catalog (product_type='dangote'); nullable because
    // legacy rows predate the catalog. Code/name are snapshots so emails and
    // agreements survive catalog edits.
    productId: integer("product_id").references(() => products.id, { onDelete: "restrict" }),
    productCode: varchar("product_code", { length: 20 }).default(""),
    productName: varchar("product_name", { length: 255 }).notNull(),

    quantity: integer("quantity").notNull(),
    // 'litre' | 'kg' is what the service writes; 'Tons' exists only on
    // migrated legacy cement rows and is never written again.
    quantityUnit: varchar("quantity_unit", { length: 20 }).default("litre").notNull(),

    deliveryAddress: text("delivery_address").notNull(),
    deliveryState: varchar("delivery_state", { length: 100 }).default(""),
    deliveryLga: varchar("delivery_lga", { length: 100 }).default(""),
    contactPerson: varchar("contact_person", { length: 255 }).default(""),
    contactPhone: varchar("contact_phone", { length: 50 }).default(""),

    // On the request, not only the customer profile: the reuse key for
    // verified documents is (customer_id, company_name_normalized).
    companyName: varchar("company_name", { length: 255 }).default(""),
    companyNameNormalized: varchar("company_name_normalized", { length: 255 }).default(""),

    status: dangoteDeliveryStatusEnum("status").default("DRAFT").notNull(),

    unitPrice: decimal("unit_price", { precision: 15, scale: 2 }),
    deliveryPrice: decimal("delivery_price", { precision: 15, scale: 2 }),
    totalAmount: decimal("total_amount", { precision: 15, scale: 2 }),
    expectedArrivalDate: varchar("expected_arrival_date", { length: 20 }),

    paymentReference: varchar("payment_reference", { length: 100 }),
    paymentMode: varchar("payment_mode", { length: 50 }),
    virtualAccountNumber: varchar("virtual_account_number", { length: 30 }).default(""),
    virtualAccountBank: varchar("virtual_account_bank", { length: 100 }).default(""),
    virtualAccountName: varchar("virtual_account_name", { length: 255 }).default(""),

    // Stage stamps — each written exactly once by its transition.
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    quotedBy: integer("quoted_by").references(() => staff.id, { onDelete: "set null" }),
    quotedAt: timestamp("quoted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    reviewedBy: integer("reviewed_by").references(() => staff.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("dangote_delivery_orders_request_number_idx").on(table.requestNumber),
    index("dangote_delivery_orders_status_idx").on(table.status),
    index("dangote_delivery_orders_customer_idx").on(table.customerId),
    index("dangote_delivery_orders_company_reuse_idx").on(
      table.customerId,
      table.companyNameNormalized
    ),
    check(
      "dangote_delivery_orders_quantity_unit_check",
      sql`${table.quantityUnit} IN ('litre', 'kg', 'Tons')`
    ),
  ]
);

module.exports = { dangoteDeliveryOrders };
