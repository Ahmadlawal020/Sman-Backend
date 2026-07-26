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
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { depositTypeEnum } = require("./enums");
const { customers } = require("./customer");
const { admins } = require("./admin");

const deposits = pgTable(
  "deposits",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    type: depositTypeEnum("type").notNull(),
    description: text("description").default(""),
    reference: varchar("reference", { length: 255 }).default(""),
    recordedBy: integer("recorded_by").references(() => admins.id, { onDelete: "set null" }),
    balanceAfter: decimal("balance_after", { precision: 15, scale: 2 }).default("0"),
    paystackDetails: jsonb("paystack_details"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("deposits_customer_created_idx").on(table.customerId, table.createdAt),
    uniqueIndex("deposits_reference_unique_idx")
      .on(table.reference)
      .where(sql`${table.reference} IS NOT NULL AND ${table.reference} != ''`),
    check("deposits_amount_check", sql`${table.amount} > 0`),
  ]
);

module.exports = { deposits };
