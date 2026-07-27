const {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { auditActorTypeEnum } = require("./enums");
const { staff } = require("./staff");
const { customers } = require("./customer");

/**
 * System-wide audit trail (contract §4.1). One append-only row per audited
 * action across any entity — orders today, more later. It is NOT what the
 * customer tracking screen reads (that comes from the order's own columns);
 * this is the immutable trail for audit and the hook the notification engine
 * subscribes to. It is also where an *undone* event survives — a voided truck,
 * a reversal — that a status column, holding only the latest value, cannot show.
 *
 * `entity_id` is intentionally NOT a foreign key: the table it points at varies
 * with `entity_type`, so it cannot reference one.
 *
 * The actor uses the same exclusive arc as `sessions`. This is not stylistic:
 * `staff.id` and `customers.id` are both serial from 1, so a single
 * `actor_id integer` would make staff #7 and customer #7 indistinguishable — an
 * audit log that silently misattributes actions is worse than none. A CHECK
 * enforces exactly one actor id for a staff/customer actor, and none for system.
 */
const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    entityType: varchar("entity_type", { length: 32 }).notNull(), // 'order' | 'customer' | …
    entityId: integer("entity_id").notNull(),
    action: varchar("action", { length: 64 }).notNull(), // 'order.released' — for humans
    prevState: varchar("prev_state", { length: 32 }),
    // The SINGLE source of a timeline entry; `action` is ignored by projections.
    newState: varchar("new_state", { length: 32 }),

    actorType: auditActorTypeEnum("actor_type").notNull(),
    actorStaffId: integer("actor_staff_id").references(() => staff.id, { onDelete: "set null" }),
    actorCustomerId: integer("actor_customer_id").references(() => customers.id, { onDelete: "set null" }),

    metadata: jsonb("metadata"), // reason, amounts, truck ids
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "audit_logs_actor_arc_check",
      sql`(${table.actorType} = 'staff'    AND ${table.actorStaffId}    IS NOT NULL AND ${table.actorCustomerId} IS NULL)
       OR (${table.actorType} = 'customer' AND ${table.actorCustomerId} IS NOT NULL AND ${table.actorStaffId}    IS NULL)
       OR (${table.actorType} = 'system'   AND ${table.actorStaffId}    IS NULL     AND ${table.actorCustomerId} IS NULL)`
    ),
    // The timeline projection: everything for one entity, in order.
    index("audit_logs_entity_idx").on(table.entityType, table.entityId, table.createdAt),
    // §4.5 staff-activity: what a given staff member did, in order.
    index("audit_logs_actor_staff_idx")
      .on(table.actorStaffId, table.createdAt)
      .where(sql`${table.actorStaffId} IS NOT NULL`),
  ]
);

module.exports = { auditLogs };
