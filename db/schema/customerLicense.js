const {
  pgTable,
  serial,
  varchar,
  integer,
  text,
  date,
  timestamp,
  index,
} = require("drizzle-orm/pg-core");
const { customers } = require("./customer");
const { staff } = require("./staff");
const { dangoteDocumentStatusEnum } = require("./enums");

// A customer's compliance license at the CUSTOMER + company level — verified
// once by staff and referenced by many orders (e.g. dangote_delivery_orders
// .license_id). Deliberately NOT Dangote-specific: it's a general customer
// license register other flows can reference later. Renewing or revoking a
// license here applies to every order that points at it. Only a storage key
// is kept; the file lives in the object store (any driver — storage_provider
// records which, so S3 and Cloudinary rows coexist) and downloads go through
// an ownership-checked, short-lived signed URL.
const customerLicenses = pgTable(
  "customer_licenses",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    companyName: varchar("company_name", { length: 255 }).notNull(),
    // Reuse key: same normalization as the order — a customer's verified
    // license for a company is offered on their next order for it.
    companyNameNormalized: varchar("company_name_normalized", { length: 255 }).notNull(),

    storageKey: varchar("storage_key", { length: 500 }).notNull(),
    storageProvider: varchar("storage_provider", { length: 20 }).default("local").notNull(),
    // Cloudinary needs the resource_type to sign downloads / delete; empty for s3/local.
    storageResourceType: varchar("storage_resource_type", { length: 20 }).default(""),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    fileSize: integer("file_size").notNull(),

    expiryDate: date("expiry_date"),
    status: dangoteDocumentStatusEnum("status").default("PENDING").notNull(),
    verifiedBy: integer("verified_by").references(() => staff.id, { onDelete: "set null" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationComment: text("verification_comment").default(""),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("customer_licenses_customer_idx").on(table.customerId),
    index("customer_licenses_reuse_idx").on(table.customerId, table.companyNameNormalized),
    index("customer_licenses_status_idx").on(table.status),
  ]
);

module.exports = { customerLicenses };
