const { bigint, serial, varchar, jsonb, timestamp, index, uniqueIndex, smallint } = require("drizzle-orm/pg-core");
const { smanSchema, waSessionStateEnum } = require("./enums");
const { consumerCustomer } = require("../consumerCustomer");
const { consumerOrder } = require("../consumerOrder");

// No live counterpart — the WhatsApp ordering engine is Sman-Backend-only.
const waSessions = smanSchema.table(
  "wa_sessions",
  {
    id: serial("id").primaryKey(),
    waPhone: varchar("wa_phone", { length: 30 }).notNull(),
    customerId: bigint("customer_id", { mode: "number" }).references(() => consumerCustomer.id, {
      onDelete: "set null",
    }),
    state: waSessionStateEnum("state").default("MENU").notNull(),
    cart: jsonb("cart").default({}).notNull(),
    lastOrderId: bigint("last_order_id", { mode: "number" }).references(() => consumerOrder.id, {
      onDelete: "set null",
    }),
    failureCount: smallint("failure_count").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("wa_sessions_phone_idx").on(table.waPhone),
    index("wa_sessions_expires_idx").on(table.expiresAt),
  ]
);

module.exports = { waSessions };
