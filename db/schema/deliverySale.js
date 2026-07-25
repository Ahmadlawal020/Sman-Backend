const {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  real,
  decimal,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { depositStatusEnum, paymentMethodEnum } = require("./enums");
const { deliveryCustomers } = require("./deliveryCustomer");

const deliverySales = pgTable(
  "delivery_sales",
  {
    id: serial("id").primaryKey(),
    truckNumber: varchar("truck_number", { length: 30 }).default(""),
    dateLoaded: varchar("date_loaded", { length: 20 }).default(""),
    depotLoaded: varchar("depot_loaded", { length: 255 }).default(""),
    customerId: integer("customer_id").references(() => deliveryCustomers.id, { onDelete: "set null" }),
    customerName: varchar("customer_name", { length: 255 }).default(""),
    location: varchar("location", { length: 255 }).default(""),
    quantity: real("quantity").default(0),
    rate: decimal("rate", { precision: 15, scale: 2 }).default("0"),
    salesValue: decimal("sales_value", { precision: 15, scale: 2 }).default("0"),
    paymentAmount: decimal("payment_amount", { precision: 15, scale: 2 }).default("0"),
    expensesAmount: decimal("expenses_amount", { precision: 15, scale: 2 }).default("0"),
    balance: decimal("balance", { precision: 15, scale: 2 }).default("0"),
    payerName: varchar("payer_name", { length: 255 }).default(""),
    bank: varchar("bank", { length: 255 }).default(""),
    dateOfPayment: varchar("date_of_payment", { length: 20 }),
    depositStatus: depositStatusEnum("deposit_status").default("pending").notNull(),
    phoneNumber: varchar("phone_number", { length: 30 }).default(""),
    remarks: text("remarks").default(""),
    enteredBy: varchar("entered_by", { length: 255 }).default(""),
    allocationCode: varchar("allocation_code", { length: 100 }),
    collectionAccounts: jsonb("collection_accounts").default(sql`'[]'::jsonb`),
    remittanceAccounts: jsonb("remittance_accounts").default(sql`'[]'::jsonb`),
    paymentMethod: paymentMethodEnum("payment_method").default("manual").notNull(),
    paystackReference: varchar("paystack_reference", { length: 255 }),
    paystackDetails: jsonb("paystack_details"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("delivery_sales_customer_idx").on(table.customerId),
    index("delivery_sales_truck_idx").on(table.truckNumber),
    uniqueIndex("delivery_sales_paystack_ref_unique_idx")
      .on(table.paystackReference)
      .where(sql`${table.paystackReference} IS NOT NULL AND ${table.paystackReference} != ''`),
  ]
);

module.exports = { deliverySales };
