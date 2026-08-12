const {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  decimal,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { dailyReportStatusEnum , reportTypeEnum } = require("./enums");
const { staff } = require("./staff");

// One location/PFI's handwritten daily sales sheet, keyed in by staff and
// reviewed by a manager. A location can run several PFIs at once, each
// reported separately — hence the composite unique key.
const dailyReports = pgTable(
  "daily_reports",
  {
    id: serial("id").primaryKey(),
    // Which report this is. Replaces the "[TAG]" suffix the old system packed
    // into submittedByName.
    reportType: reportTypeEnum("report_type").default("sales_manager").notNull(),
    reportDate: date("report_date").notNull(),
    location: varchar("location", { length: 255 }).notNull(),
    pfiNumber: varchar("pfi_number", { length: 50 }).default("").notNull(),
    productName: varchar("product_name", { length: 100 }).default(""),

    // Stock movement (litres)
    carriedOverLoading: decimal("carried_over_loading", { precision: 15, scale: 2 }).default("0"),
    openingStock: decimal("opening_stock", { precision: 15, scale: 2 }).default("0"),
    receivedStock: decimal("received_stock", { precision: 15, scale: 2 }).default("0"),
    litresSold: decimal("litres_sold", { precision: 15, scale: 2 }).default("0").notNull(),
    tankBalance: decimal("tank_balance", { precision: 15, scale: 2 }).default("0"),
    loadingLeftOver: decimal("loading_left_over", { precision: 15, scale: 2 }).default("0"),

    // A day can sell at several prices: [{ "price": "850.00", "litres": "20000" }].
    // avgPrice / litresSold stay in sync as the derived scalars.
    priceBands: jsonb("price_bands").default(sql`'[]'::jsonb`),
    avgPrice: decimal("avg_price", { precision: 12, scale: 2 }).default("0"),
    totalSalesAmount: decimal("total_sales_amount", { precision: 15, scale: 2 }).default("0").notNull(),
    amountPaid: decimal("amount_paid", { precision: 15, scale: 2 }).default("0").notNull(),
    differentials: decimal("differentials", { precision: 15, scale: 2 }).default("0"),
    truckCount: integer("truck_count").default(0).notNull(),

    bankName: varchar("bank_name", { length: 255 }).default(""),
    accountNumber: varchar("account_number", { length: 50 }).default(""),
    // Commission and compliance fields. The old system had no columns for
    // these and encoded them into remarks as "Customers: 12 | Orders: 30" and
    // "RATES: …", recovering them by regex — so editing your own note silently
    // destroyed the numbers.
    customerCount: integer("customer_count"),
    orderCount: integer("order_count"),
    rates: text("rates").default(""),
    remarks: text("remarks").default(""),

    // Workflow: submitted -> approved | rejected (manager review).
    status: dailyReportStatusEnum("status").default("submitted").notNull(),
    submittedBy: integer("submitted_by").references(() => staff.id, { onDelete: "set null" }),
    submittedByName: varchar("submitted_by_name", { length: 255 }).default(""),
    reviewedBy: integer("reviewed_by").references(() => staff.id, { onDelete: "set null" }),
    reviewedByName: varchar("reviewed_by_name", { length: 255 }).default(""),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewComment: text("review_comment").default(""),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // reportType is part of the key: five report types share this table, so
    // without it filing a gate report would block the same person filing a
    // commission report for the same day and location.
    uniqueIndex("daily_reports_unique_idx").on(
      table.reportType,
      table.reportDate,
      table.location,
      table.pfiNumber,
      table.submittedBy
    ),
    index("daily_reports_date_location_idx").on(table.reportDate, table.location),
    index("daily_reports_status_idx").on(table.status),
    check("daily_reports_litres_check", sql`${table.litresSold} >= 0`),
    check("daily_reports_trucks_check", sql`${table.truckCount} >= 0`),
  ]
);

module.exports = { dailyReports };
