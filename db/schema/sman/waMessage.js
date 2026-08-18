const { bigint, serial, varchar, integer, jsonb, text, timestamp, index, uniqueIndex } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema, waMessageDirectionEnum, waMessageStatusEnum } = require("./enums");
const { waSessions } = require("./waSession");
const { consumerCustomer } = require("../consumerCustomer");

const waMessages = smanSchema.table(
  "wa_messages",
  {
    id: serial("id").primaryKey(),
    wamid: varchar("wamid", { length: 128 }),
    direction: waMessageDirectionEnum("direction").notNull(),
    waPhone: varchar("wa_phone", { length: 30 }).notNull(),
    sessionId: integer("session_id").references(() => waSessions.id, { onDelete: "set null" }),
    customerId: bigint("customer_id", { mode: "number" }).references(() => consumerCustomer.id, {
      onDelete: "set null",
    }),
    // No FK, matching the original — the retry guard just needs the id.
    inReplyTo: integer("in_reply_to"),
    payload: jsonb("payload").notNull(),
    status: waMessageStatusEnum("status").notNull(),
    error: text("error").default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("wa_messages_wamid_idx")
      .on(table.wamid)
      .where(sql`${table.wamid} IS NOT NULL`),
    index("wa_messages_session_idx").on(table.sessionId, table.createdAt),
    index("wa_messages_phone_dir_idx").on(table.waPhone, table.direction, table.createdAt),
    index("wa_messages_status_idx").on(table.status, table.createdAt),
    index("wa_messages_reply_to_idx").on(table.inReplyTo),
  ]
);

module.exports = { waMessages };
