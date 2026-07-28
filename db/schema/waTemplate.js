const {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  uniqueIndex,
} = require("drizzle-orm/pg-core");
const { waTemplateStatusEnum } = require("./enums");

/**
 * Local mirror of the WABA's message templates. Outside the 24-hour service
 * window only Meta-approved templates may be sent, and Meta can pause or
 * reject one at any time without a deploy on our side — so the send path
 * checks this table, and a non-approved template reroutes that notification
 * to SMS rather than silently vanishing. A daily sync refreshes meta_status.
 */
const waTemplates = pgTable(
  "wa_templates",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    language: varchar("language", { length: 16 }).default("en").notNull(),
    category: varchar("category", { length: 40 }).default(""),
    metaStatus: waTemplateStatusEnum("meta_status").default("pending").notNull(),
    body: text("body").default(""),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("wa_templates_name_idx").on(table.name, table.language)]
);

module.exports = { waTemplates };
