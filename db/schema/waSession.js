const {
  pgTable,
  serial,
  varchar,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} = require("drizzle-orm/pg-core");
const { waSessionStateEnum } = require("./enums");
const { customers } = require("./customer");
const { orders } = require("./order");

/**
 * One live WhatsApp conversation per phone number. The cart is jsonb scratch
 * space for the order being built — a REAL order only ever exists in `orders`,
 * created through placeOrder at CONFIRM. An abandoned cart costs nothing:
 * `expires_at` passes and the sweep deletes the row.
 *
 * Postgres has no Mongo-style TTL index, so expiry is explicit: reads treat a
 * session past `expires_at` as expired (the engine then offers resume), and a
 * pg-boss cron deletes rows a grace period (24 h) beyond it — deleting AT
 * expiry would destroy the cart the resume offer needs.
 */
const waSessions = pgTable(
  "wa_sessions",
  {
    id: serial("id").primaryKey(),
    // E.164 with the leading `+` — exactly what utils/phone.toE164 returns.
    waPhone: varchar("wa_phone", { length: 30 }).notNull(),
    customerId: integer("customer_id").references(() => customers.id, { onDelete: "set null" }),
    state: waSessionStateEnum("state").default("MENU").notNull(),
    cart: jsonb("cart").default({}).notNull(),
    lastOrderId: integer("last_order_id").references(() => orders.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("wa_sessions_phone_idx").on(table.waPhone),
    // Serves both the expiry filter on reads and the sweep's delete.
    index("wa_sessions_expires_idx").on(table.expiresAt),
  ]
);

module.exports = { waSessions };
