const {
  pgTable,
  serial,
  varchar,
  text,
  decimal,
  timestamp,
  index,
  uniqueIndex,
} = require("drizzle-orm/pg-core");
const { customerStatusEnum } = require("./enums");

const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).default(""),
    phone: varchar("phone", { length: 30 }).notNull(),
    companyName: varchar("company_name", { length: 255 }).default(""),
    address: text("address").default(""),
    status: customerStatusEnum("status").default("Active").notNull(),
    balance: decimal("balance", { precision: 15, scale: 2 }).default("0").notNull(),
    deposit: decimal("deposit", { precision: 15, scale: 2 }).default("0").notNull(),
    previousDeposit: decimal("previous_deposit", { precision: 15, scale: 2 }).default("0").notNull(),
    paystackCustomerId: varchar("paystack_customer_id", { length: 100 }).default(""),
    virtualAccountNumber: varchar("virtual_account_number", { length: 30 }).default(""),
    virtualAccountBank: varchar("virtual_account_bank", { length: 100 }).default(""),
    virtualAccountName: varchar("virtual_account_name", { length: 255 }).default(""),
    // Written by verify-otp; cleared by any phone change, which also revokes
    // every session for the customer.
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("customers_phone_idx").on(table.phone),
    index("customers_email_idx").on(table.email),
    index("customers_virtual_account_idx").on(table.virtualAccountNumber),
  ]
);

module.exports = { customers };
