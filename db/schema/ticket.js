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
const { ticketStatusEnum } = require("./enums");
const { orders } = require("./order");
const { staff } = require("./staff");

const tickets = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    ticketNumber: varchar("ticket_number", { length: 50 }).notNull(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
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
    index("tickets_status_idx").on(table.status),
  ]
);

module.exports = { tickets };
