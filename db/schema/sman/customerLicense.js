const { bigint, serial, varchar, text, date, timestamp, index } = require("drizzle-orm/pg-core");
const { smanSchema, licenseVerificationStatusEnum } = require("./enums");
const { consumerCustomer } = require("../consumerCustomer");
const { administrationUser } = require("../administrationUser");

const customerLicenses = smanSchema.table(
  "customer_licenses",
  {
    id: serial("id").primaryKey(),
    customerId: bigint("customer_id", { mode: "number" })
      .notNull()
      .references(() => consumerCustomer.id, { onDelete: "restrict" }),
    companyName: varchar("company_name", { length: 255 }).notNull(),
    licenseUrl: text("license_url").default(""),
    licensePublicId: text("license_public_id").default(""),
    expiryDate: date("expiry_date"),
    status: licenseVerificationStatusEnum("status").default("pending").notNull(),
    verifiedBy: bigint("verified_by", { mode: "number" }).references(() => administrationUser.id, {
      onDelete: "set null",
    }),
    verifiedByName: varchar("verified_by_name", { length: 255 }).default(""),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationComment: text("verification_comment").default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("customer_licenses_customer_id_idx").on(table.customerId),
    index("customer_licenses_status_idx").on(table.status),
  ]
);

module.exports = { customerLicenses };
