const { bigint, serial, varchar, text, timestamp, uniqueIndex } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema } = require("./enums");
const { administrationUser } = require("../administrationUser");

const messageTemplates = smanSchema.table(
  "message_templates",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 150 }).notNull(),
    subject: varchar("subject", { length: 200 }).default(""),
    body: text("body").notNull(),
    channels: text("channels").array().default(sql`ARRAY[]::text[]`).notNull(),
    createdBy: bigint("created_by", { mode: "number" }).references(() => administrationUser.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("message_templates_name_idx").on(sql`lower(${table.name})`)]
);

module.exports = { messageTemplates };
