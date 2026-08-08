const {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const {
  principalTypeEnum,
  notificationCategoryEnum,
  notificationPriorityEnum,
} = require("./enums");
const { staff } = require("./staff");
const { customers } = require("./customer");

/**
 * The in-app inbox — one row per (recipient, notification). This is the record
 * the mobile app, the admin dashboard and the web portal all read; push, email
 * and SMS are copies of it pushed outward, not separate truths.
 *
 * Recipients use the same exclusive arc as `sessions`: exactly one of
 * staff_id / customer_id is set, enforced by a CHECK rather than by convention.
 * A single table was chosen over per-realm tables for the same reason sessions
 * were — "mark everything read for this principal" is one code path, and the
 * unread-count query would otherwise be written twice.
 *
 * `data` carries the deep-link payload the clients navigate with
 * (e.g. { orderId, orderNumber, screen: "OrderDetail" }). It is deliberately
 * jsonb and not a set of columns: every notification type needs a different
 * shape, and the engine's catalog — not the database — is where that shape is
 * declared.
 */
const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),

    recipientType: principalTypeEnum("recipient_type").notNull(),
    staffId: integer("staff_id").references(() => staff.id, { onDelete: "cascade" }),
    customerId: integer("customer_id").references(() => customers.id, { onDelete: "cascade" }),

    // The catalog key, e.g. "order.released". Kept as free text rather than an
    // enum: the catalog gains entries far more often than the schema should
    // gain migrations, and an unknown type must degrade to a readable row
    // rather than fail the insert.
    type: varchar("type", { length: 64 }).notNull(),
    category: notificationCategoryEnum("category").notNull(),
    priority: notificationPriorityEnum("priority").default("normal").notNull(),

    title: varchar("title", { length: 255 }).notNull(),
    body: text("body").notNull(),

    // Deep-link payload for the clients. FCM flattens this to string values on
    // the way out; the row keeps the real types.
    data: jsonb("data").default(sql`'{}'::jsonb`).notNull(),

    // What the notification is ABOUT, for "show me everything on this order".
    entityType: varchar("entity_type", { length: 64 }).default("").notNull(),
    entityId: varchar("entity_id", { length: 64 }).default("").notNull(),

    // Web deep link (dashboard/portal). Mobile navigates from `data` instead.
    actionUrl: text("action_url"),
    imageUrl: text("image_url"),

    // Idempotency for the fan-out. The settlement sweep and the payment webhook
    // can both observe the same payment; a stable key per (recipient, event)
    // makes the second insert a no-op instead of a duplicate buzz.
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
    // The inbox query: newest first, scoped to one principal.
    index("notifications_staff_idx")
      .on(table.staffId, table.createdAt)
      .where(sql`${table.staffId} IS NOT NULL`),
    index("notifications_customer_idx")
      .on(table.customerId, table.createdAt)
      .where(sql`${table.customerId} IS NOT NULL`),
    // The badge query. Partial, because unread rows are the small minority
    // that gets counted on every app foreground.
    index("notifications_staff_unread_idx")
      .on(table.staffId)
      .where(sql`${table.readAt} IS NULL AND ${table.archivedAt} IS NULL AND ${table.staffId} IS NOT NULL`),
    index("notifications_customer_unread_idx")
      .on(table.customerId)
      .where(sql`${table.readAt} IS NULL AND ${table.archivedAt} IS NULL AND ${table.customerId} IS NOT NULL`),
    index("notifications_entity_idx").on(table.entityType, table.entityId),
    // Partial unique: rows without a dedupe key are never in conflict with
    // each other, which a plain unique index would get wrong only if NULLs
    // compared equal — they don't, but the predicate also keeps the index small.
    uniqueIndex("notifications_dedupe_key_idx")
      .on(table.dedupeKey)
      .where(sql`${table.dedupeKey} IS NOT NULL`),
  ]
);

module.exports = { notifications };
