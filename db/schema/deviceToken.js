const {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { principalTypeEnum, deviceTokenPlatformEnum } = require("./enums");
const { staff } = require("./staff");
const { customers } = require("./customer");

/**
 * Push registrations — one row per (device, principal). The mobile app posts
 * its FCM token here after sign-in and on every token refresh; the web app can
 * register a browser token against the same table.
 *
 * Two facts drive the design:
 *
 *  1. A token belongs to a DEVICE, not to a person. When someone signs out and
 *     a colleague signs in on the same handset, FCM hands back the same token —
 *     so `token` is globally unique and re-registering it moves it to the new
 *     principal rather than creating a second row. Without that, the previous
 *     user keeps receiving the new user's notifications.
 *
 *  2. Tokens die silently. FCM reports UNREGISTERED/INVALID_ARGUMENT only at
 *     send time, so the send path writes `disabled_at` back here. A disabled
 *     row is kept, not deleted: it explains why a device stopped buzzing.
 */
const deviceTokens = pgTable(
  "device_tokens",
  {
    id: serial("id").primaryKey(),

    principalType: principalTypeEnum("principal_type").notNull(),
    staffId: integer("staff_id").references(() => staff.id, { onDelete: "cascade" }),
    customerId: integer("customer_id").references(() => customers.id, { onDelete: "cascade" }),

    token: text("token").notNull(),
    // Only "fcm" today (iOS is relayed through FCM's APNs bridge). Stored so a
    // second provider can be added without a migration or a token wipe.
    provider: varchar("provider", { length: 16 }).default("fcm").notNull(),
    platform: deviceTokenPlatformEnum("platform").notNull(),

    // The app's stable install id. Lets a re-registration replace THIS device's
    // previous token instead of accumulating one dead row per token refresh.
    deviceId: varchar("device_id", { length: 128 }).default("").notNull(),
    deviceName: varchar("device_name", { length: 255 }).default("").notNull(),
    appVersion: varchar("app_version", { length: 32 }).default("").notNull(),
    locale: varchar("locale", { length: 16 }).default("").notNull(),
    timezone: varchar("timezone", { length: 64 }).default("").notNull(),

    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    // Consecutive send failures. Reset on success; a permanent provider verdict
    // disables immediately rather than waiting for this to climb.
    failureCount: integer("failure_count").default(0).notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    // unregistered | invalid | logout | principal_deactivated | replaced
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
    // The send-path lookup: every live token for one principal.
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
