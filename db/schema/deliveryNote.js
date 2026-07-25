const {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  real,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const {
  deliveryCustomerTypeEnum,
  deliveryNoteStatusEnum,
} = require("./enums");
const { deliveryCustomers } = require("./deliveryCustomer");
const { orders } = require("./order");
const { admins } = require("./admin");

const deliveryNotes = pgTable(
  "delivery_notes",
  {
    id: serial("id").primaryKey(),
    deliveryNoteNumber: varchar("delivery_note_number", { length: 50 }).notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => deliveryCustomers.id, { onDelete: "restrict" }),
    customerTypeSnapshot: deliveryCustomerTypeEnum("customer_type_snapshot").notNull(),
    orderId: integer("order_id").references(() => orders.id, { onDelete: "set null" }),
    deliveryAddress: text("delivery_address").notNull(),
    contactPersonOnSite: jsonb("contact_person_on_site").default(sql`'{}'::jsonb`),
    product: varchar("product", { length: 255 }).notNull(),
    quantityDelivered: real("quantity_delivered").notNull(),
    unit: varchar("unit", { length: 30 }).default("Liters"),
    driver: jsonb("driver").default(sql`'{}'::jsonb`),
    truck: jsonb("truck").default(sql`'{}'::jsonb`),
    depotOfLoading: varchar("depot_of_loading", { length: 255 }).default(""),
    dispatchDate: timestamp("dispatch_date", { withTimezone: true }).defaultNow(),
    expectedDeliveryDate: timestamp("expected_delivery_date", { withTimezone: true }),
    status: deliveryNoteStatusEnum("status").default("Pending").notNull(),
    remarks: text("remarks").default(""),
    createdBy: integer("created_by").references(() => admins.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("delivery_notes_number_idx").on(table.deliveryNoteNumber),
    index("delivery_notes_customer_idx").on(table.customerId),
    index("delivery_notes_status_idx").on(table.status),
    check("delivery_notes_qty_check", sql`${table.quantityDelivered} > 0`),
  ]
);

module.exports = { deliveryNotes };
