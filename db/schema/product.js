const {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
} = require("drizzle-orm/pg-core");
const { productTypeEnum, productStatusEnum } = require("./enums");

const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    sku: varchar("sku", { length: 50 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    productType: productTypeEnum("product_type").default("soroman").notNull(),
    gradeClass: varchar("grade_class", { length: 100 }).default(""),
    description: text("description").default(""),
    density: varchar("density", { length: 50 }).default(""),
    flashPoint: varchar("flash_point", { length: 50 }).default(""),
    unNumber: varchar("un_number", { length: 50 }).default(""),
    hazardClass: varchar("hazard_class", { length: 50 }).default("None"),
    stockLevel: integer("stock_level").default(0),
    unit: varchar("unit", { length: 30 }).default("Liters"),
    status: productStatusEnum("status").default("Active").notNull(),
    supplier: varchar("supplier", { length: 255 }).default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("products_sku_idx").on(table.sku),
    index("products_type_idx").on(table.productType),
  ]
);

module.exports = { products };
