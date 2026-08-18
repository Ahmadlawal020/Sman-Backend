const { serial, varchar, text, timestamp, jsonb, index } = require("drizzle-orm/pg-core");
const { smanSchema, webhookStatusEnum } = require("./enums");

const webhookEvents = smanSchema.table(
  "webhook_events",
  {
    id: serial("id").primaryKey(),
    event: varchar("event", { length: 100 }).notNull(),
    payload: jsonb("payload").notNull(),
    status: webhookStatusEnum("status").default("pending").notNull(),
    error: text("error").default(""),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("webhook_events_status_created_idx").on(table.status, table.createdAt)]
);

module.exports = { webhookEvents };
