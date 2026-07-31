const {
  pgTable,
  serial,
  varchar,
  integer,
  date,
  timestamp,
  index,
} = require("drizzle-orm/pg-core");
const { dangoteDeliveryOrders } = require("./dangoteDeliveryOrder");
const { staff } = require("./staff");
const { dangoteDocumentStatusEnum } = require("./enums");

// Compliance documents for a Dangote delivery order (DPR/NUPRC license
// first). Only a storage key is kept — bytes live in the object store, and
// downloads go through an ownership-checked endpoint, never a stored URL.
// One live row per (order, type); replacement swaps the row. Reuse across a
// customer's requests copies the row, pointing at the same storage key.
const dangoteDeliveryDocuments = pgTable(
  "dangote_delivery_documents",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => dangoteDeliveryOrders.id, { onDelete: "cascade" }),
    documentType: varchar("document_type", { length: 50 })
      .default("DPR_NUPRC_LICENSE")
      .notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    storageKey: varchar("storage_key", { length: 500 }).notNull(),
    status: dangoteDocumentStatusEnum("status").default("PENDING").notNull(),
    verifiedBy: integer("verified_by").references(() => staff.id, { onDelete: "set null" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiryDate: date("expiry_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("dangote_delivery_documents_order_idx").on(table.orderId),
    index("dangote_delivery_documents_storage_key_idx").on(table.storageKey),
  ]
);

module.exports = { dangoteDeliveryDocuments };
