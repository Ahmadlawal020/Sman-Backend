const {
  pgTable,
  serial,
  varchar,
  integer,
  text,
  timestamp,
  uniqueIndex,
} = require("drizzle-orm/pg-core");
const { dangoteDeliveryOrders } = require("./dangoteDeliveryOrder");

// The e-signed agreement for a Dangote delivery order. Generated fresh at
// terms-accept and regenerated on re-sign after NEEDS_CHANGES (one row per
// order — regeneration replaces it). Snapshots who/what/where at signing
// time; deliberately carries NO money — pricing arrives later on the staff
// quote and the agreement must not imply one.
const dangoteDeliveryAgreements = pgTable(
  "dangote_delivery_agreements",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => dangoteDeliveryOrders.id, { onDelete: "cascade" }),

    customerName: varchar("customer_name", { length: 255 }).notNull(),
    companyName: varchar("company_name", { length: 255 }).default(""),
    deliveryAddress: text("delivery_address").notNull(),
    deliveryState: varchar("delivery_state", { length: 100 }).default(""),
    productCode: varchar("product_code", { length: 20 }).default(""),
    productName: varchar("product_name", { length: 255 }).notNull(),
    quantity: integer("quantity").notNull(),
    quantityUnit: varchar("quantity_unit", { length: 20 }).notNull(),

    signatureFullName: varchar("signature_full_name", { length: 255 }).notNull(),
    signatureInitials: varchar("signature_initials", { length: 20 }).default(""),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
    termsVersion: varchar("terms_version", { length: 20 }).notNull(),
    userAgent: text("user_agent").default(""),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("dangote_delivery_agreements_order_idx").on(table.orderId)]
);

module.exports = { dangoteDeliveryAgreements };
