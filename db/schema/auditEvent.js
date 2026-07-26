const {
  pgTable,
  serial,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
} = require("drizzle-orm/pg-core");
const { auditActorTypeEnum } = require("./enums");

// Append-only record of business actions: who did what to which entity.
// Rows are written by the audit listener on the event bus, so every
// emitEvent() in a service lands here without the service knowing.
const auditEvents = pgTable(
  "audit_events",
  {
    id: serial("id").primaryKey(),
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
