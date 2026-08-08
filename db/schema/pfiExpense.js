const {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  decimal,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { expenseStatusEnum } = require("./enums");
const { pfis } = require("./pfi");
const { orders } = require("./order");
const { staff } = require("./staff");

/**
 * Expenses never point at a PFI directly — they point at a category, and the
 * category carries the PFI link. Every PFI gets a system category on creation
 * so that choosing it on an expense is what stamps `pfi_id` on the line.
 *
 * `pfiId` null means a general category (Transportation, Salaries, …).
 */
const expenseCategories = pgTable(
  "expense_categories",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    // The PFI this category stands for; null for a general category.
    pfiId: integer("pfi_id").references(() => pfis.id, { onDelete: "cascade" }),
    // System categories are PFI-backed and cannot be renamed or deleted by hand.
    isSystemCategory: boolean("is_system_category").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("expense_categories_name_idx").on(table.name),
    // One category per PFI. Partial, so the many general categories (pfi_id null)
    // are unaffected.
    uniqueIndex("expense_categories_pfi_idx")
      .on(table.pfiId)
      .where(sql`${table.pfiId} IS NOT NULL`),
  ]
);

/**
 * A cost booked against a category. `pfiId` is mirrored from the category on
 * every write — it is never accepted from the client.
 *
 * Deletes are soft: `deletedAt` is set, the row stays, and every total filters
 * it out.
 */
const pfiExpenses = pgTable(
  "pfi_expenses",
  {
    id: serial("id").primaryKey(),
    // Mirrored from the category. Denormalised on purpose: it is what every
    // total groups by, and it must not move when a category is later re-pointed.
    pfiId: integer("pfi_id").references(() => pfis.id, { onDelete: "set null" }),
    categoryId: integer("category_id")
      .references(() => expenseCategories.id, { onDelete: "restrict" })
      .notNull(),
    expenseDate: timestamp("expense_date", { withTimezone: true }).defaultNow().notNull(),
    vendor: varchar("vendor", { length: 255 }).default(""),
    description: text("description").default(""),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    bankPaidFrom: varchar("bank_paid_from", { length: 255 }).default(""),
    receiptReference: varchar("receipt_reference", { length: 100 }).default(""),

    // ── Where the money is going ──────────────────────────────────────────
    // Captured on the request so an approver can see the destination account
    // before authorising, rather than after.
    payeeBankName: varchar("payee_bank_name", { length: 200 }).default(""),
    payeeAccountNumber: varchar("payee_account_number", { length: 50 }).default(""),
    payeeAccountName: varchar("payee_account_name", { length: 255 }).default(""),

    // ── The approval chain ────────────────────────────────────────────────
    status: expenseStatusEnum("status").default("pending").notNull(),

    // One pair per stage, written once and never overwritten, so who signed
    // what survives even after the request moves on. `reviewed*` is the
    // opposite: "last touched by", rewritten on every transition.
    verifiedBy: integer("verified_by").references(() => staff.id, { onDelete: "set null" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    auditApprovedBy: integer("audit_approved_by").references(() => staff.id, { onDelete: "set null" }),
    auditApprovedAt: timestamp("audit_approved_at", { withTimezone: true }),
    adminApprovedBy: integer("admin_approved_by").references(() => staff.id, { onDelete: "set null" }),
    adminApprovedAt: timestamp("admin_approved_at", { withTimezone: true }),
    paidBy: integer("paid_by").references(() => staff.id, { onDelete: "set null" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),

    reviewedBy: integer("reviewed_by").references(() => staff.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // Most recent reason only. Durable history lives in pfi_expense_audits —
    // read reasons from there, or a rejection note vanishes once the corrected
    // request is later approved.
    reviewNote: text("review_note").default(""),

    addedBy: integer("added_by").references(() => staff.id, { onDelete: "set null" }),
    editedBy: integer("edited_by").references(() => staff.id, { onDelete: "set null" }),
    // Free-text display name, kept for historical rows.
    enteredBy: varchar("entered_by", { length: 255 }).default(""),
    // The actual audit trail.
    recordedBy: integer("recorded_by").references(() => staff.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("pfi_expenses_pfi_idx").on(table.pfiId),
    index("pfi_expenses_category_idx").on(table.categoryId),
    index("pfi_expenses_date_idx").on(table.expenseDate),
    index("pfi_expenses_status_idx").on(table.status),
    // Every total reads live rows only; this keeps that path off a seq scan.
    index("pfi_expenses_live_idx").on(table.pfiId).where(sql`${table.deletedAt} IS NULL`),
    check("pfi_expenses_amount_check", sql`${table.amount} >= 0`),
  ]
);

/**
 * Append-only stock ledger. One row per release; the unique constraint on
 * (order, action) is what makes ticket generation idempotent — the same order
 * can never deduct the same PFI twice no matter how often it runs.
 */
const pfiMovements = pgTable(
  "pfi_movements",
  {
    id: serial("id").primaryKey(),
    pfiId: integer("pfi_id")
      .references(() => pfis.id, { onDelete: "cascade" })
      .notNull(),
    orderId: integer("order_id").references(() => orders.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 30 }).default("RELEASE").notNull(),
    qtyLitres: integer("qty_litres").notNull(),
    notes: text("notes").default(""),
    recordedBy: integer("recorded_by").references(() => staff.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("pfi_movements_order_action_idx").on(table.orderId, table.action),
    index("pfi_movements_pfi_idx").on(table.pfiId),
  ]
);

/**
 * A receipt or supporting document.
 *
 * No type, size or count validation anywhere — deliberately. A receipt is
 * whatever the vendor handed over, and refusing a file at upload time just
 * means it never gets attached at all.
 */
const pfiExpenseAttachments = pgTable(
  "pfi_expense_attachments",
  {
    id: serial("id").primaryKey(),
    expenseId: integer("expense_id")
      .references(() => pfiExpenses.id, { onDelete: "cascade" })
      .notNull(),
    // Storage key, not a public URL. Files are streamed through an authorised
    // route so receipts never sit on a public path.
    storageKey: text("storage_key").notNull(),
    fileName: varchar("file_name", { length: 255 }).default(""),
    contentType: varchar("content_type", { length: 120 }).default(""),
    sizeBytes: integer("size_bytes").default(0),
    uploadedBy: integer("uploaded_by").references(() => staff.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("pfi_expense_attachments_expense_idx").on(table.expenseId)]
);

/** Every create, edit, delete and transition writes one of these. */
const pfiExpenseAudits = pgTable(
  "pfi_expense_audits",
  {
    id: serial("id").primaryKey(),
    expenseId: integer("expense_id").references(() => pfiExpenses.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 20 }).notNull(),
    changes: jsonb("changes").default({}),
    actorId: integer("actor_id").references(() => staff.id, { onDelete: "set null" }),
    actorName: varchar("actor_name", { length: 255 }).default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("pfi_expense_audits_expense_idx").on(table.expenseId)]
);

module.exports = {
  expenseCategories,
  pfiExpenses,
  pfiExpenseAttachments,
  pfiMovements,
  pfiExpenseAudits,
};
