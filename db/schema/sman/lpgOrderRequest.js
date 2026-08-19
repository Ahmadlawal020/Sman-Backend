const { bigint, serial, varchar, integer, decimal, text, timestamp, index } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { consumerCustomer } = require("../consumerCustomer");
const { consumerLpgplant } = require("../consumerLpgplant");
const { administrationUser } = require("../administrationUser");

// No live counterpart — same story as dangote_order_requests: Django's own
// LPG tables (consumer_lpgsale/consumer_lpgstockentry) are the physical
// station sale ledger, not this customer-facing wallet-funded request flow.
const lpgOrderRequests = smanSchema.table(
  "lpg_order_requests",
  {
    id: serial("id").primaryKey(),
    requestNumber: varchar("request_number", { length: 50 }).notNull(),
    customerId: bigint("customer_id", { mode: "number" })
      .notNull()
      .references(() => consumerCustomer.id, { onDelete: "restrict" }),
    companyName: varchar("company_name", { length: 255 }).default(""),
    lpgStationId: bigint("lpg_station_id", { mode: "number" }).references(() => consumerLpgplant.id, {
      onDelete: "set null",
    }),
    cylinderSizeKg: integer("cylinder_size_kg").notNull(),
    cylinderQuantity: integer("cylinder_quantity").notNull(),
    deliveryAddress: text("delivery_address").notNull(),
    deliveryState: varchar("delivery_state", { length: 100 }).default(""),
    deliveryLga: varchar("delivery_lga", { length: 100 }).default(""),
    status: varchar("status", { length: 30 }).default("Pending Review").notNull(),
    paymentStatus: varchar("payment_status", { length: 20 }).default("Unpaid").notNull(),
    collectionStatus: varchar("collection_status", { length: 20 }).default("Pending").notNull(),
    pricePerKg: decimal("price_per_kg", { precision: 15, scale: 2 }),
    deliveryPrice: decimal("delivery_price", { precision: 15, scale: 2 }),
    totalAmount: decimal("total_amount", { precision: 15, scale: 2 }),
    expectedArrivalDate: varchar("expected_arrival_date", { length: 20 }),
    paymentReference: varchar("payment_reference", { length: 100 }),
    paymentMode: varchar("payment_mode", { length: 50 }),
    virtualAccountNumber: varchar("virtual_account_number", { length: 30 }).default(""),
    virtualAccountBank: varchar("virtual_account_bank", { length: 100 }).default(""),
    virtualAccountName: varchar("virtual_account_name", { length: 255 }).default(""),
    reviewedBy: bigint("reviewed_by", { mode: "number" }).references(() => administrationUser.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("lpg_requests_status_idx").on(table.status),
    index("lpg_requests_customer_idx").on(table.customerId),
  ]
);

module.exports = { lpgOrderRequests };
