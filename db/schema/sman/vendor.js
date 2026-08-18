const { bigint, serial, varchar, text, timestamp, uniqueIndex } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema } = require("./enums");
const { administrationUser } = require("../administrationUser");

// No live counterpart — consumer_pfiexpense has no vendor_id column at all,
// only a free-text `vendor` name. See sman/pfiExpenseExtras.js for the
// vendor_id linkage kept alongside the live expense row.
const vendors = smanSchema.table(
  "vendors",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    contactPerson: varchar("contact_person", { length: 255 }).default(""),
    phone: varchar("phone", { length: 50 }).default(""),
    email: varchar("email", { length: 255 }).default(""),
    address: text("address").default(""),
    bankName: varchar("bank_name", { length: 200 }).default(""),
    accountNumber: varchar("account_number", { length: 50 }).default(""),
    accountName: varchar("account_name", { length: 255 }).default(""),
    taxId: varchar("tax_id", { length: 50 }).default(""),
    status: varchar("status", { length: 20 }).default("Active").notNull(),
    createdBy: bigint("created_by", { mode: "number" }).references(() => administrationUser.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("vendors_name_idx").on(sql`lower(${table.name})`)]
);

module.exports = { vendors };
