const { bigint, serial, varchar, text, char, uuid, timestamp, index, uniqueIndex, check } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema, principalTypeEnum } = require("./enums");
const { administrationUser } = require("../administrationUser");
const { consumerCustomer } = require("../consumerCustomer");

/**
 * JWT refresh-token rotation, for both staff and customer auth. No live
 * Django counterpart at all (Django uses its own session/token mechanism —
 * django_session / administration_usertoken — for a completely different
 * auth system); this is Sman-Backend's own, unchanged in shape from the
 * pre-cutover clean-room table, just re-pointed at the live principal
 * tables.
 *
 * One sessions table for both realms, using an exclusive arc: exactly one of
 * staff_id / customer_id is set, enforced by a CHECK rather than by
 * convention.
 */
const sessions = smanSchema.table(
  "sessions",
  {
    id: serial("id").primaryKey(),
    principalType: principalTypeEnum("principal_type").notNull(),
    staffId: bigint("staff_id", { mode: "number" }).references(() => administrationUser.id, { onDelete: "cascade" }),
    customerId: bigint("customer_id", { mode: "number" }).references(() => consumerCustomer.id, { onDelete: "cascade" }),

    // sha256(principal_type + ":" + token), lowercase hex — always 64 chars.
    refreshTokenHash: char("refresh_token_hash", { length: 64 }).notNull(),

    familyId: uuid("family_id").notNull(),
    replacedById: bigint("replaced_by_id", { mode: "number" }),
    // rotated | logout | logout_all | reuse_detected
    // | password_change | principal_deactivated | phone_changed
    // | account_deleted
    revokedReason: varchar("revoked_reason", { length: 32 }),

    deviceName: varchar("device_name", { length: 255 }).default(""),
    userAgent: text("user_agent"),
    ipAddress: varchar("ip_address", { length: 64 }),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "sessions_principal_arc_check",
      sql`(${table.principalType} = 'staff'    AND ${table.staffId}    IS NOT NULL AND ${table.customerId} IS NULL)
       OR (${table.principalType} = 'customer' AND ${table.customerId} IS NOT NULL AND ${table.staffId}    IS NULL)`
    ),
    uniqueIndex("sessions_refresh_token_hash_idx").on(table.refreshTokenHash),
    index("sessions_staff_idx")
      .on(table.staffId, table.createdAt)
      .where(sql`${table.staffId} IS NOT NULL`),
    index("sessions_customer_idx")
      .on(table.customerId, table.createdAt)
      .where(sql`${table.customerId} IS NOT NULL`),
    index("sessions_family_idx").on(table.familyId),
    index("sessions_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.revokedAt} IS NULL`),
  ]
);

module.exports = { sessions };
