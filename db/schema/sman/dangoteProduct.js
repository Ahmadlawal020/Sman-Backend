const { serial, varchar, text, timestamp, index } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");

// No live counterpart — the Dangote order line of business has no
// representation in soroman_db at all.
const dangoteProducts = smanSchema.table(
  "dangote_products",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    sku: varchar("sku", { length: 50 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    unit: varchar("unit", { length: 30 }).default("Tons").notNull(),
    description: text("description").default(""),
    plants: text("plants").default("[]").notNull(),
    status: varchar("status", { length: 20 }).default("Active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("dangote_products_status_idx").on(table.status)]
);

module.exports = { dangoteProducts };
