const {
  pgTable,
  serial,
  varchar,
  integer,
  decimal,
  text,
  timestamp,
  index,
} = require("drizzle-orm/pg-core");
const { customers } = require("./customer");
const { customerLicenses } = require("./companyLicense");
const { staff } = require("./staff");

const dangoteOrderRequests = pgTable(
  "dangote_order_requests",
  {
    id: serial("id").primaryKey(),
    requestNumber: varchar("request_number", { length: 50 }).notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    companyName: varchar("company_name", { length: 255 }).default(""),
    licenseId: integer("license_id").references(() => customerLicenses.id, { onDelete: "set null" }),
    product: varchar("product", { length: 255 }).notNull(),
    quantity: integer("quantity").notNull(),
    quantityUnit: varchar("quantity_unit", { length: 20 }).default("Tons").notNull(),
    deliveryAddress: text("delivery_address").notNull(),
    deliveryState: varchar("delivery_state", { length: 100 }).default(""),
    deliveryLga: varchar("delivery_lga", { length: 100 }).default(""),
    status: varchar("status", { length: 30 }).default("Pending Review").notNull(),
    paymentStatus: varchar("payment_status", { length: 20 }).default("Unpaid").notNull(),
    collectionStatus: varchar("collection_status", { length: 20 }).default("Pending").notNull(),
    pricePerUnit: decimal("price_per_unit", { precision: 15, scale: 2 }),
    deliveryPrice: decimal("delivery_price", { precision: 15, scale: 2 }),
    totalAmount: decimal("total_amount", { precision: 15, scale: 2 }),
    expectedArrivalDate: varchar("expected_arrival_date", { length: 20 }),
    paymentReference: varchar("payment_reference", { length: 100 }),
    paymentMode: varchar("payment_mode", { length: 50 }),
    virtualAccountNumber: varchar("virtual_account_number", { length: 30 }).default(""),
    virtualAccountBank: varchar("virtual_account_bank", { length: 100 }).default(""),
    virtualAccountName: varchar("virtual_account_name", { length: 255 }).default(""),
    reviewedBy: integer("reviewed_by").references(() => staff.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("dangote_requests_status_idx").on(table.status),
    index("dangote_requests_customer_idx").on(table.customerId),
  ]
);

module.exports = { dangoteOrderRequests };
