const { bigint, serial, integer, varchar, text, timestamp, index, uniqueIndex, check } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema, principalTypeEnum, deviceTokenPlatformEnum } = require("./enums");
const { administrationUser } = require("../administrationUser");
const { consumerCustomer } = require("../consumerCustomer");

// No live counterpart — the push-notification engine (docs/NOTIFICATIONS.md)
// is Sman-Backend-only.
const deviceTokens = smanSchema.table(
  "device_tokens",
  {
    id: serial("id").primaryKey(),

    principalType: principalTypeEnum("principal_type").notNull(),
    staffId: bigint("staff_id", { mode: "number" }).references(() => administrationUser.id, {
      onDelete: "cascade",
    }),
    customerId: bigint("customer_id", { mode: "number" }).references(() => consumerCustomer.id, {
      onDelete: "cascade",
    }),

    token: text("token").notNull(),
    provider: varchar("provider", { length: 16 }).default("fcm").notNull(),
    platform: deviceTokenPlatformEnum("platform").notNull(),

    deviceId: varchar("device_id", { length: 128 }).default("").notNull(),
    deviceName: varchar("device_name", { length: 255 }).default("").notNull(),
    appVersion: varchar("app_version", { length: 32 }).default("").notNull(),
    locale: varchar("locale", { length: 16 }).default("").notNull(),
    timezone: varchar("timezone", { length: 64 }).default("").notNull(),

    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    failureCount: integer("failure_count").default(0).notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledReason: varchar("disabled_reason", { length: 64 }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "device_tokens_principal_arc_check",
      sql`(${table.principalType} = 'staff'    AND ${table.staffId}    IS NOT NULL AND ${table.customerId} IS NULL)
       OR (${table.principalType} = 'customer' AND ${table.customerId} IS NOT NULL AND ${table.staffId}    IS NULL)`
    ),
    uniqueIndex("device_tokens_token_idx").on(table.token),
    index("device_tokens_staff_idx")
      .on(table.staffId)
      .where(sql`${table.disabledAt} IS NULL AND ${table.staffId} IS NOT NULL`),
    index("device_tokens_customer_idx")
      .on(table.customerId)
      .where(sql`${table.disabledAt} IS NULL AND ${table.customerId} IS NOT NULL`),
    index("device_tokens_device_idx")
      .on(table.deviceId)
      .where(sql`${table.deviceId} <> ''`),
  ]
);

module.exports = { deviceTokens };
