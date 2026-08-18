const { bigint, varchar, integer, jsonb, timestamp, index } = require("drizzle-orm/pg-core");
const { smanSchema, auditActorTypeEnum } = require("./enums");

/**
 * Append-only record of business actions: who did what to which entity.
 * Rows are written by the audit listener on the app-wide event bus (see
 * services/audit.service.js's `onEvent("*", ...)`), so every emitEvent()
 * anywhere in the app lands here without the caller knowing.
 *
 * Sman-Backend-owned — no live Django counterpart, same reasoning as
 * audit_logs (see sman/auditLog.js): this is deliberately polymorphic across
 * every entity type the event bus carries, which neither
 * consumer_auditlog nor consumer_orderauditevent (both order-only) can hold.
 */
const auditEvents = smanSchema.table(
  "audit_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    action: varchar("action", { length: 100 }).notNull(),
    actorType: auditActorTypeEnum("actor_type").default("system").notNull(),
    actorId: integer("actor_id"),
    actorName: varchar("actor_name", { length: 255 }).default(""),
    entityType: varchar("entity_type", { length: 100 }).default(""),
    entityId: varchar("entity_id", { length: 64 }).default(""),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_events_entity_idx").on(table.entityType, table.entityId),
    index("audit_events_action_idx").on(table.action),
    index("audit_events_created_idx").on(table.createdAt),
  ]
);

module.exports = { auditEvents };
