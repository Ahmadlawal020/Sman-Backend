const {
  pgTable,
  serial,
  integer,
  varchar,
  boolean,
  smallint,
  timestamp,
  index,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { principalTypeEnum, notificationCategoryEnum } = require("./enums");
const { staff } = require("./staff");
const { customers } = require("./customer");

/**
 * Per-category channel opt-outs. Absence of a row means "use the catalog's
 * defaults" — the table stores DEVIATIONS, not the full matrix, so a new
 * category ships working defaults without a backfill for every principal.
 */
const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: serial("id").primaryKey(),

    principalType: principalTypeEnum("principal_type").notNull(),
    staffId: integer("staff_id").references(() => staff.id, { onDelete: "cascade" }),
    customerId: integer("customer_id").references(() => customers.id, { onDelete: "cascade" }),

    category: notificationCategoryEnum("category").notNull(),

    inApp: boolean("in_app").default(true).notNull(),
    push: boolean("push").default(true).notNull(),
    email: boolean("email").default(true).notNull(),
    sms: boolean("sms").default(true).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "notification_preferences_principal_arc_check",
      sql`(${table.principalType} = 'staff'    AND ${table.staffId}    IS NOT NULL AND ${table.customerId} IS NULL)
       OR (${table.principalType} = 'customer' AND ${table.customerId} IS NOT NULL AND ${table.staffId}    IS NULL)`
    ),
    // One row per principal per category. Two partial indexes rather than one
    // composite: a plain unique on (staff_id, customer_id, category) would let
    // duplicates through, because in SQL NULL is never equal to NULL.
    uniqueIndex("notification_preferences_staff_idx")
      .on(table.staffId, table.category)
      .where(sql`${table.staffId} IS NOT NULL`),
    uniqueIndex("notification_preferences_customer_idx")
      .on(table.customerId, table.category)
      .where(sql`${table.customerId} IS NOT NULL`),
  ]
);

/**
 * Per-principal master switches and quiet hours — one row, or none at all.
 *
 * Kept apart from notification_preferences deliberately. These are properties
 * of the PERSON (their timezone, when they sleep, whether push works for them
 * at all), while preferences are properties of the (person, category) pair.
 * Folding them together would mean either columns that are meaningful on only
 * one magic row, or the same quiet-hours values copied across ten category rows
 * and updated ten at a time.
 *
 * Quiet hours are minutes-past-midnight in the principal's own timezone, and a
 * window may wrap (22:00 → 07:00 is start 1320, end 420). Only `push` and `sms`
 * respect it — an in-app row is silent by nature, and email lands in an inbox
 * nobody is woken by. `urgent` priority ignores it entirely.
 */
const notificationSettings = pgTable(
  "notification_settings",
  {
    id: serial("id").primaryKey(),

    principalType: principalTypeEnum("principal_type").notNull(),
    staffId: integer("staff_id").references(() => staff.id, { onDelete: "cascade" }),
    customerId: integer("customer_id").references(() => customers.id, { onDelete: "cascade" }),

    // Master kill switches, applied after the per-category check.
    pushEnabled: boolean("push_enabled").default(true).notNull(),
    emailEnabled: boolean("email_enabled").default(true).notNull(),
    smsEnabled: boolean("sms_enabled").default(true).notNull(),

    quietHoursEnabled: boolean("quiet_hours_enabled").default(false).notNull(),
    quietHoursStart: smallint("quiet_hours_start").default(1320).notNull(), // 22:00
    quietHoursEnd: smallint("quiet_hours_end").default(420).notNull(), // 07:00

    // IANA zone, e.g. "Africa/Lagos". Empty falls back to NOTIFY_DEFAULT_TZ.
    timezone: varchar("timezone", { length: 64 }).default("").notNull(),
    locale: varchar("locale", { length: 16 }).default("").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "notification_settings_principal_arc_check",
      sql`(${table.principalType} = 'staff'    AND ${table.staffId}    IS NOT NULL AND ${table.customerId} IS NULL)
       OR (${table.principalType} = 'customer' AND ${table.customerId} IS NOT NULL AND ${table.staffId}    IS NULL)`
    ),
    check(
      "notification_settings_quiet_hours_range_check",
      sql`${table.quietHoursStart} BETWEEN 0 AND 1439 AND ${table.quietHoursEnd} BETWEEN 0 AND 1439`
    ),
    uniqueIndex("notification_settings_staff_idx")
      .on(table.staffId)
      .where(sql`${table.staffId} IS NOT NULL`),
    uniqueIndex("notification_settings_customer_idx")
      .on(table.customerId)
      .where(sql`${table.customerId} IS NOT NULL`),
  ]
);

module.exports = { notificationPreferences, notificationSettings };
