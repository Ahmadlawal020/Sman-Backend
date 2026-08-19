const { bigint, varchar, integer, text, jsonb, timestamp, index, check } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema, auditActorTypeEnum } = require("./enums");
const { administrationUser } = require("../administrationUser");
const { consumerCustomer } = require("../consumerCustomer");

/**
 * System-wide audit trail (Sman-Backend-owned — no live Django counterpart:
 * consumer_auditlog / consumer_orderauditevent are both hard-scoped to a
 * single order via a NOT NULL order_id FK, but this table is written for
 * many entity types — order, order_truck, customer, delivery_inventory,
 * fleet_truck, lpg_order_request, dangote_order_request, offline_sale,
 * incident_record, customer_license, daily_report, notification — so it
 * cannot be represented by either. See docs/LIVE_DB_CUTOVER.md §4/§7.
 *
 * `entity_id` is intentionally NOT a foreign key: the table it points at
 * varies with `entity_type`, so it cannot reference one.
 *
 * The actor uses an exclusive arc, same shape as before the cutover:
 * administration_user.id and consumer_customer.id are both independent
 * bigint identities, so a single actor_id would make staff #7 and customer
 * #7 indistinguishable — an audit log that silently misattributes actions is
 * worse than none. The CHECK enforces exactly one actor id for a
 * staff/customer actor, and none for system.
 */
const auditLogs = smanSchema.table(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    entityType: varchar("entity_type", { length: 32 }).notNull(), // 'order' | 'customer' | …
    entityId: integer("entity_id").notNull(),
    action: varchar("action", { length: 64 }).notNull(), // 'order.released' — for humans
    prevState: varchar("prev_state", { length: 32 }),
    // The SINGLE source of a timeline entry; `action` is ignored by projections.
    newState: varchar("new_state", { length: 32 }),

    actorType: auditActorTypeEnum("actor_type").notNull(),
    actorStaffId: bigint("actor_staff_id", { mode: "number" }).references(() => administrationUser.id, {
      onDelete: "set null",
    }),
    actorCustomerId: bigint("actor_customer_id", { mode: "number" }).references(() => consumerCustomer.id, {
      onDelete: "set null",
    }),

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
    // Staff-activity: what a given staff member did, in order.
    index("audit_logs_actor_staff_idx")
      .on(table.actorStaffId, table.createdAt)
      .where(sql`${table.actorStaffId} IS NOT NULL`),
  ]
);

module.exports = { auditLogs };
