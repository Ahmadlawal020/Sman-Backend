const { bigint, serial, varchar, text, jsonb, timestamp, index, uniqueIndex, check } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema, principalTypeEnum, notificationCategoryEnum, notificationPriorityEnum } = require("./enums");
const { administrationUser } = require("../administrationUser");
const { consumerCustomer } = require("../consumerCustomer");

// No live counterpart — the in-app inbox (docs/NOTIFICATIONS.md) is
// Sman-Backend-only.
const notifications = smanSchema.table(
  "notifications",
  {
    id: serial("id").primaryKey(),

    recipientType: principalTypeEnum("recipient_type").notNull(),
    staffId: bigint("staff_id", { mode: "number" }).references(() => administrationUser.id, {
      onDelete: "cascade",
    }),
    customerId: bigint("customer_id", { mode: "number" }).references(() => consumerCustomer.id, {
      onDelete: "cascade",
    }),

    type: varchar("type", { length: 64 }).notNull(),
    category: notificationCategoryEnum("category").notNull(),
    priority: notificationPriorityEnum("priority").default("normal").notNull(),

    title: varchar("title", { length: 255 }).notNull(),
    body: text("body").notNull(),

    data: jsonb("data").default(sql`'{}'::jsonb`).notNull(),

    entityType: varchar("entity_type", { length: 64 }).default("").notNull(),
    entityId: varchar("entity_id", { length: 64 }).default("").notNull(),

    actionUrl: text("action_url"),
    imageUrl: text("image_url"),

    dedupeKey: varchar("dedupe_key", { length: 160 }),

    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "notifications_recipient_arc_check",
      sql`(${table.recipientType} = 'staff'    AND ${table.staffId}    IS NOT NULL AND ${table.customerId} IS NULL)
       OR (${table.recipientType} = 'customer' AND ${table.customerId} IS NOT NULL AND ${table.staffId}    IS NULL)`
    ),
    index("notifications_staff_idx")
      .on(table.staffId, table.createdAt)
      .where(sql`${table.staffId} IS NOT NULL`),
    index("notifications_customer_idx")
      .on(table.customerId, table.createdAt)
      .where(sql`${table.customerId} IS NOT NULL`),
    index("notifications_staff_unread_idx")
      .on(table.staffId)
      .where(sql`${table.readAt} IS NULL AND ${table.archivedAt} IS NULL AND ${table.staffId} IS NOT NULL`),
    index("notifications_customer_unread_idx")
      .on(table.customerId)
      .where(sql`${table.readAt} IS NULL AND ${table.archivedAt} IS NULL AND ${table.customerId} IS NOT NULL`),
    index("notifications_entity_idx").on(table.entityType, table.entityId),
    uniqueIndex("notifications_dedupe_key_idx")
      .on(table.dedupeKey)
      .where(sql`${table.dedupeKey} IS NOT NULL`),
  ]
);

module.exports = { notifications };
