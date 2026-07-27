const {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  real,
  decimal,
  boolean,
  timestamp,
  jsonb,
  index,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { loadingStatusEnum, releaseStatusEnum } = require("./enums");
const { trucks } = require("./truck");
const { pfis } = require("./pfi");
const { deliveryCustomers } = require("./deliveryCustomer");

const deliveryInventory = pgTable(
  "delivery_inventory",
  {
    id: serial("id").primaryKey(),
    truckId: integer("truck_id").references(() => trucks.id, { onDelete: "set null" }),
    truckNumber: varchar("truck_number", { length: 30 }).default(""),
    pfiId: integer("pfi_id").references(() => pfis.id, { onDelete: "set null" }),
    pfiNumber: varchar("pfi_number", { length: 100 }).default(""),
    pfiProduct: varchar("pfi_product", { length: 255 }).default(""),
    depot: varchar("depot", { length: 255 }).default(""),
    customerId: integer("customer_id").references(() => deliveryCustomers.id, { onDelete: "set null" }),
    customerName: varchar("customer_name", { length: 255 }).default(""),
    quantityAllocated: real("quantity_allocated").default(0),
    rate: decimal("rate", { precision: 15, scale: 2 }).default("0"),
    dateAllocated: varchar("date_allocated", { length: 20 }).default(""),
    dateOffloaded: varchar("date_offloaded", { length: 20 }),
    loadingStatus: loadingStatusEnum("loading_status").default("loaded").notNull(),
    location: varchar("location", { length: 255 }).default(""),
    pfiLocation: varchar("pfi_location", { length: 255 }).default(""),
    allocationCode: varchar("allocation_code", { length: 100 }),
    collectionAccounts: jsonb("collection_accounts").default(sql`'[]'::jsonb`),
    remittanceAccounts: jsonb("remittance_accounts").default(sql`'[]'::jsonb`),
    notes: text("notes").default(""),
    createdBy: varchar("created_by", { length: 255 }).default(""),
    offloadedBy: varchar("offloaded_by", { length: 255 }).default(""),
    // Release workflow: pending -> confirmed (payment verified) -> released
    // (ticket issued, product leaves the depot). Transitions are one-way and
    // enforced by the delivery service, which also emits the audit events.
    releaseStatus: releaseStatusEnum("release_status").default("pending").notNull(),
    confirmedBy: varchar("confirmed_by", { length: 255 }).default(""),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    releasedBy: varchar("released_by", { length: 255 }).default(""),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason").default(""),
    ticketNumber: varchar("ticket_number", { length: 100 }).default(""),
    ticketGeneratedAt: timestamp("ticket_generated_at", { withTimezone: true }),
    isFullyPaid: boolean("is_fully_paid").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("delivery_inventory_truck_idx").on(table.truckId),
    index("delivery_inventory_pfi_idx").on(table.pfiId),
    index("delivery_inventory_customer_idx").on(table.customerId),
    index("delivery_inventory_status_idx").on(table.loadingStatus),
  ]
);

module.exports = { deliveryInventory };
