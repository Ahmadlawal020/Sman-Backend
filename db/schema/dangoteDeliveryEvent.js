const {
  pgTable,
  serial,
  varchar,
  integer,
  text,
  timestamp,
  index,
} = require("drizzle-orm/pg-core");
const { dangoteDeliveryOrders } = require("./dangoteDeliveryOrder");
const { auditActorTypeEnum } = require("./enums");

// Append-only timeline for a Dangote delivery order. Written by the
// transition service on every status change (and notable staff actions like
// document verify/reject). Powers the customer tracker; `note` carries
// customer-visible context such as the NEEDS_CHANGES reason.
const dangoteDeliveryEvents = pgTable(
  "dangote_delivery_events",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => dangoteDeliveryOrders.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 100 }).notNull(),
    note: text("note").default(""),
    actorType: auditActorTypeEnum("actor_type").default("system").notNull(),
    actorId: integer("actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("dangote_delivery_events_order_idx").on(table.orderId)]
);

module.exports = { dangoteDeliveryEvents };
