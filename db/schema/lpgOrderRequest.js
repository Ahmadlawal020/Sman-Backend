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
const { lpgStations } = require("./lpgStation");
const { staff } = require("./staff");

const lpgOrderRequests = pgTable(
  "lpg_order_requests",
  {
    id: serial("id").primaryKey(),
    requestNumber: varchar("request_number", { length: 50 }).notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    lpgStationId: integer("lpg_station_id")
      .notNull()
      .references(() => lpgStations.id, { onDelete: "restrict" }),
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
    reviewedBy: integer("reviewed_by").references(() => staff.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("lpg_requests_status_idx").on(table.status),
    index("lpg_requests_customer_idx").on(table.customerId),
    index("lpg_requests_station_idx").on(table.lpgStationId),
  ]
);

module.exports = { lpgOrderRequests };
