const {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  decimal,
  timestamp,
  jsonb,
  index,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { incidentTypeEnum, incidentStatusEnum } = require("./enums");
const { staff } = require("./staff");
const { pfis } = require("./pfi");

// Field records: incidents, expense requests, maintenance notes, observations
// and compliance items, each moving through submitted -> reviewed ->
// resolved | rejected. Successor to Django's Record model.
const incidentRecords = pgTable(
  "incident_records",
  {
    id: serial("id").primaryKey(),
    incidentType: incidentTypeEnum("incident_type").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").default(""),
    location: varchar("location", { length: 255 }).default(""),
    amount: decimal("amount", { precision: 15, scale: 2 }),

    pfiId: integer("pfi_id").references(() => pfis.id, { onDelete: "set null" }),
    pfiNumber: varchar("pfi_number", { length: 100 }).default(""),

    // [{ name, url, contentType, uploadedAt }] — storage-agnostic pointers.
    attachments: jsonb("attachments").default(sql`'[]'::jsonb`),
    metadata: jsonb("metadata"),

    status: incidentStatusEnum("status").default("submitted").notNull(),
    statusNote: text("status_note").default(""),
    submittedBy: integer("submitted_by").references(() => staff.id, { onDelete: "set null" }),
    submittedByName: varchar("submitted_by_name", { length: 255 }).default(""),
    reviewedBy: integer("reviewed_by").references(() => staff.id, { onDelete: "set null" }),
    reviewedByName: varchar("reviewed_by_name", { length: 255 }).default(""),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("incident_records_type_idx").on(table.incidentType),
    index("incident_records_status_idx").on(table.status),
    index("incident_records_created_idx").on(table.createdAt),
    check(
      "incident_records_amount_check",
      sql`${table.amount} IS NULL OR ${table.amount} >= 0`
    ),
  ]
);

module.exports = { incidentRecords };
