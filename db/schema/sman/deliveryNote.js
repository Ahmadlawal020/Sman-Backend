const { bigint, serial, varchar, text, real, timestamp, jsonb, index, uniqueIndex, check } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema, deliveryCustomerTypeEnum, deliveryNoteStatusEnum } = require("./enums");
const { administrationDeliverycustomer } = require("../administrationDeliverycustomer");
const { consumerOrder } = require("../consumerOrder");
const { administrationUser } = require("../administrationUser");

/**
 * Sman-Backend's own delivery-note/waybill document — no live counterpart.
 * consumer_deliveryorders (docs/LIVE_DB_CUTOVER.md §3, low confidence) is a
 * much sparser table (just delivery_address/date/time + order_id) — plain
 * delivery-scheduling metadata, not this rich waybill (contact on site,
 * product, driver, truck, depot of loading, status workflow). Kept exactly
 * as the pre-cutover clean-room table had it, re-pointed at the live
 * delivery-customer/order/staff tables.
 */
const deliveryNotes = smanSchema.table(
  "delivery_notes",
  {
    id: serial("id").primaryKey(),
    deliveryNoteNumber: varchar("delivery_note_number", { length: 50 }).notNull(),
    customerId: bigint("customer_id", { mode: "number" })
      .notNull()
      .references(() => administrationDeliverycustomer.id, { onDelete: "restrict" }),
    customerTypeSnapshot: deliveryCustomerTypeEnum("customer_type_snapshot").notNull(),
    orderId: bigint("order_id", { mode: "number" }).references(() => consumerOrder.id, { onDelete: "set null" }),
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
    createdBy: bigint("created_by", { mode: "number" }).references(() => administrationUser.id, { onDelete: "set null" }),
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
