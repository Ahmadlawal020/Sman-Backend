const {
  pgTable,
  serial,
  varchar,
  integer,
  jsonb,
  text,
  timestamp,
  index,
  uniqueIndex,
} = require("drizzle-orm/pg-core");
const { waMessageDirectionEnum, waMessageStatusEnum } = require("./enums");
const { waSessions } = require("./waSession");
const { customers } = require("./customer");

/**
 * Every WhatsApp message that crosses the wire, both directions. Four jobs:
 *
 *  1. Dedupe — `wamid` is Meta's globally unique message id and they retry
 *     deliveries for up to 7 days; the unique index is the entire mechanism.
 *  2. Per-send status — outbound rows advance queued → sent → delivered →
 *     read / failed, updated by Meta's status webhooks. Never fire-and-forget.
 *  3. The 24-hour service window — "when did this customer last message us"
 *     is the newest inbound row for the phone.
 *  4. The transcript — support's answer to "the bot took my order wrong".
 *
 * FKs SET NULL: the session sweep must never eat the transcript.
 */
const waMessages = pgTable(
  "wa_messages",
  {
    id: serial("id").primaryKey(),
    wamid: varchar("wamid", { length: 128 }).notNull(),
    direction: waMessageDirectionEnum("direction").notNull(),
    waPhone: varchar("wa_phone", { length: 30 }).notNull(),
    sessionId: integer("session_id").references(() => waSessions.id, { onDelete: "set null" }),
    customerId: integer("customer_id").references(() => customers.id, { onDelete: "set null" }),
    // Inbound: Meta's raw message object. Outbound: the engine reply as data.
    payload: jsonb("payload").notNull(),
    status: waMessageStatusEnum("status").notNull(),
    error: text("error").default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("wa_messages_wamid_idx").on(table.wamid),
    // The transcript projection, in order.
    index("wa_messages_session_idx").on(table.sessionId, table.createdAt),
    // The service-window question: newest inbound for a phone.
    index("wa_messages_phone_dir_idx").on(table.waPhone, table.direction, table.createdAt),
    // The janitor: inbound rows still unprocessed after a crash.
    index("wa_messages_status_idx").on(table.status, table.createdAt),
  ]
);

module.exports = { waMessages };
