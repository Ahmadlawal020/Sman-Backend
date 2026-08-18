const { bigint, serial, varchar, boolean, smallint, timestamp, index, uniqueIndex, check } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema, principalTypeEnum, notificationCategoryEnum } = require("./enums");
const { administrationUser } = require("../administrationUser");
const { consumerCustomer } = require("../consumerCustomer");

const notificationPreferences = smanSchema.table(
  "notification_preferences",
  {
    id: serial("id").primaryKey(),

    principalType: principalTypeEnum("principal_type").notNull(),
    staffId: bigint("staff_id", { mode: "number" }).references(() => administrationUser.id, {
      onDelete: "cascade",
    }),
    customerId: bigint("customer_id", { mode: "number" }).references(() => consumerCustomer.id, {
      onDelete: "cascade",
    }),

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
    uniqueIndex("notification_preferences_staff_idx")
      .on(table.staffId, table.category)
      .where(sql`${table.staffId} IS NOT NULL`),
    uniqueIndex("notification_preferences_customer_idx")
      .on(table.customerId, table.category)
      .where(sql`${table.customerId} IS NOT NULL`),
  ]
);

const notificationSettings = smanSchema.table(
  "notification_settings",
  {
    id: serial("id").primaryKey(),

    principalType: principalTypeEnum("principal_type").notNull(),
    staffId: bigint("staff_id", { mode: "number" }).references(() => administrationUser.id, {
      onDelete: "cascade",
    }),
    customerId: bigint("customer_id", { mode: "number" }).references(() => consumerCustomer.id, {
      onDelete: "cascade",
    }),

    pushEnabled: boolean("push_enabled").default(true).notNull(),
    emailEnabled: boolean("email_enabled").default(true).notNull(),
    smsEnabled: boolean("sms_enabled").default(true).notNull(),

    quietHoursEnabled: boolean("quiet_hours_enabled").default(false).notNull(),
    quietHoursStart: smallint("quiet_hours_start").default(1320).notNull(),
    quietHoursEnd: smallint("quiet_hours_end").default(420).notNull(),

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
