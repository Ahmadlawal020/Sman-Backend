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
  uniqueIndex,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const {
  deliveryCustomerTypeEnum,
  deliveryCustomerStatusEnum,
} = require("./enums");
const { staff } = require("./staff");

const deliveryCustomers = pgTable(
  "delivery_customers",
  {
    id: serial("id").primaryKey(),
    customerType: deliveryCustomerTypeEnum("customer_type").notNull(),
    customerCode: varchar("customer_code", { length: 50 }),
    name: varchar("name", { length: 255 }).notNull(),
    phoneNumber: varchar("phone_number", { length: 30 }).notNull(),
    altPhoneNumber: varchar("alt_phone_number", { length: 30 }).default(""),
    email: varchar("email", { length: 255 }).default(""),
    // Individual customer fields
    homeAddress: text("home_address").default(""),
    officeAddress: text("office_address").default(""),
    passportPhoto: text("passport_photo").default(""),
    // Filling station fields
    contactPerson: varchar("contact_person", { length: 255 }).default(""),
    contactPersonPhone: varchar("contact_person_phone", { length: 30 }).default(""),
    stationAddress: text("station_address").default(""),
    tankCapacity: integer("tank_capacity").default(0),
    pumpCount: integer("pump_count").default(1),
    // Bank details (JSONB)
    bankDetails: jsonb("bank_details").default(sql`'{}'::jsonb`),
    // Paystack DVA
    paystackCustomerId: varchar("paystack_customer_id", { length: 100 }).default(""),
    virtualAccountNumber: varchar("virtual_account_number", { length: 30 }).default(""),
    virtualAccountBank: varchar("virtual_account_bank", { length: 100 }).default(""),
    virtualAccountName: varchar("virtual_account_name", { length: 255 }).default(""),
    creditLimit: decimal("credit_limit", { precision: 15, scale: 2 }).default("0"),
    status: deliveryCustomerStatusEnum("status").default("active").notNull(),
    notes: text("notes").default(""),
    lastTransactionDate: timestamp("last_transaction_date", { withTimezone: true }),
    createdBy: integer("created_by").references(() => staff.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("delivery_customers_code_idx").on(table.customerCode),
    index("delivery_customers_type_idx").on(table.customerType),
    index("delivery_customers_status_idx").on(table.status),
    index("delivery_customers_virtual_account_idx").on(table.virtualAccountNumber),
  ]
);

module.exports = { deliveryCustomers };
