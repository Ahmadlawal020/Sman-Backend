const {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { ticketStatusEnum } = require("./enums");
const { orders } = require("./order");
const { orderTrucks } = require("./orderTruck");
const { staff } = require("./staff");

const tickets = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    ticketNumber: varchar("ticket_number", { length: 50 }).notNull(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    // The per-truck link. Nullable: existing per-order tickets have none; new
    // per-truck tickets carry it, one ticket per truck load.
    orderTruckId: integer("order_truck_id").references(() => orderTrucks.id, { onDelete: "cascade" }),
    status: ticketStatusEnum("status").default("Active").notNull(),
    qrCodeDataUrl: text("qr_code_data_url").notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    redeemedBy: integer("redeemed_by").references(() => staff.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("tickets_ticket_number_idx").on(table.ticketNumber),
    index("tickets_order_idx").on(table.orderId),
    index("tickets_order_truck_idx").on(table.orderTruckId).where(sql`${table.orderTruckId} IS NOT NULL`),
    index("tickets_status_idx").on(table.status),
  ]
);

module.exports = { tickets };
