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

/** Every create, edit and delete of an expense line writes one of these. */
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

module.exports = { expenseCategories, pfiExpenses, pfiMovements, pfiExpenseAudits };
