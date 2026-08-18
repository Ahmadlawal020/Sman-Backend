const { serial, varchar, text, timestamp, uniqueIndex } = require("drizzle-orm/pg-core");
const { smanSchema, waTemplateStatusEnum } = require("./enums");

const waTemplates = smanSchema.table(
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
