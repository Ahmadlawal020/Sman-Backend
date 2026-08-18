const { bigint, serial, integer, varchar, text, timestamp, index } = require("drizzle-orm/pg-core");
const { smanSchema, principalTypeEnum, notificationChannelEnum, notificationDeliveryStatusEnum } = require("./enums");
const { notifications } = require("./notification");

// staffId/customerId are deliberately plain columns with no FK and no
// exclusive-arc CHECK, matching the original design — this is a delivery log
// and must still record sends with no principal behind them at all.
const notificationDeliveries = smanSchema.table(
  "notification_deliveries",
  {
    id: serial("id").primaryKey(),

    notificationId: bigint("notification_id", { mode: "number" }).references(() => notifications.id, {
      onDelete: "cascade",
    }),

    principalType: principalTypeEnum("principal_type"),
    staffId: integer("staff_id"),
    customerId: integer("customer_id"),

    type: varchar("type", { length: 64 }).notNull(),
    channel: notificationChannelEnum("channel").notNull(),

    destination: varchar("destination", { length: 255 }).default("").notNull(),

    status: notificationDeliveryStatusEnum("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    providerMessageId: varchar("provider_message_id", { length: 255 }).default("").notNull(),
    error: text("error"),

    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("notification_deliveries_notification_idx").on(table.notificationId),
    index("notification_deliveries_channel_status_idx").on(table.channel, table.status, table.createdAt),
    index("notification_deliveries_type_idx").on(table.type, table.createdAt),
    index("notification_deliveries_staff_idx").on(table.staffId, table.createdAt),
    index("notification_deliveries_customer_idx").on(table.customerId, table.createdAt),
  ]
);

module.exports = { notificationDeliveries };
