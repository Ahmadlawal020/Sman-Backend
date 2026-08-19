const { bigint, varchar, integer, decimal, text, jsonb, timestamp } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema } = require("./enums");
const { administrationStaffdailysalesreport } = require("../administrationStaffdailysalesreport");

/**
 * administration_staffdailysalesreport (the live row, canonical) has no
 * review workflow at all (no status/reviewedBy/reviewComment — its own
 * cousin table, administration_dailyreportapproval, is a one-row-per-DATE
 * sign-off flag, not a per-report review) and no report_type column. This
 * table restores exactly those fields, 1:1 keyed to the live report.
 *
 * CAVEAT: the live table's own unique constraint is
 * (date, location, submitted_by_id, pfi_number) — it has no report_type in
 * that key, so two different report types filed by the SAME staff member for
 * the same day/location/pfi cannot both exist (the second insert is
 * rejected). This is fine as long as different report types are always
 * filed by different staff (e.g. a sales manager vs. a gate guard), which
 * matches how filing works today, but it is a real structural limit the old
 * clean-room schema didn't have — flag this to whoever owns daily-reports-v2
 * if that assumption is ever wrong.
 */
const dailyReportExtras = smanSchema.table("daily_report_extras", {
  reportId: bigint("report_id", { mode: "number" })
    .primaryKey()
    .references(() => administrationStaffdailysalesreport.id, { onDelete: "cascade" }),
  reportType: varchar("report_type", { length: 30 }).default("sales_manager").notNull(),
  productName: varchar("product_name", { length: 100 }).default(""),
  openingStock: decimal("opening_stock", { precision: 15, scale: 2 }).default("0"),
  receivedStock: decimal("received_stock", { precision: 15, scale: 2 }).default("0"),
  avgPrice: decimal("avg_price", { precision: 12, scale: 2 }).default("0"),
  yesterdayDeficitPayment: decimal("yesterday_deficit_payment", { precision: 15, scale: 2 }).default("0"),
  yesterdaySurplusPayment: decimal("yesterday_surplus_payment", { precision: 15, scale: 2 }).default("0"),
  totalInflow: decimal("total_inflow", { precision: 15, scale: 2 }).default("0"),
  trucksEntered: integer("trucks_entered"),
  customerCount: integer("customer_count"),
  orderCount: integer("order_count"),
  rates: text("rates").default(""),
  topCustomers: jsonb("top_customers").default(sql`'[]'::jsonb`),
  status: varchar("status", { length: 20 }).default("submitted").notNull(),
  reviewedBy: bigint("reviewed_by", { mode: "number" }),
  reviewedByName: varchar("reviewed_by_name", { length: 255 }).default(""),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewComment: text("review_comment").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

module.exports = { dailyReportExtras };
