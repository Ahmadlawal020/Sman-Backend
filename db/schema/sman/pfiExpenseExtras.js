const { bigint, serial, varchar, decimal, text, timestamp } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { consumerPfiexpense } = require("../consumerPfiexpense");
const { vendors } = require("./vendor");

// consumer_pfiexpense (the live row, canonical) has no vendor_id FK and no
// VAT/WHT invoice breakdown or explicit payment reference/method/date — this
// table holds exactly those fields, 1:1 keyed to the live expense.
const pfiExpenseExtras = smanSchema.table("pfi_expense_extras", {
  expenseId: bigint("expense_id", { mode: "number" })
    .primaryKey()
    .references(() => consumerPfiexpense.id, { onDelete: "cascade" }),
  vendorId: bigint("vendor_id", { mode: "number" }).references(() => vendors.id, { onDelete: "set null" }),
  tinNumber: varchar("tin_number", { length: 30 }).default(""),
  invoiceNumber: varchar("invoice_number", { length: 100 }).default(""),
  amountExVat: decimal("amount_ex_vat", { precision: 15, scale: 2 }),
  vatAmount: decimal("vat_amount", { precision: 15, scale: 2 }),
  invoiceAmount: decimal("invoice_amount", { precision: 15, scale: 2 }),
  whtDeduction: decimal("wht_deduction", { precision: 15, scale: 2 }),
  whtRate: decimal("wht_rate", { precision: 5, scale: 2 }),
  bankCode: varchar("bank_code", { length: 20 }).default(""),
  paymentReference: varchar("payment_reference", { length: 100 }).default(""),
  paymentDate: timestamp("payment_date", { withTimezone: true }),
  paymentMethod: varchar("payment_method", { length: 30 }).default(""),
  paymentNotes: text("payment_notes").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

module.exports = { pfiExpenseExtras };
