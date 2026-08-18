const { bigint, varchar, timestamp } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { consumerExpensecategory } = require("../consumerExpensecategory");

// consumer_expensecategory (the live row, canonical) has no GL
// chart-of-accounts fields — this table holds exactly those, 1:1 keyed to
// the live category.
const expenseCategoryExtras = smanSchema.table("expense_category_extras", {
  categoryId: bigint("category_id", { mode: "number" })
    .primaryKey()
    .references(() => consumerExpensecategory.id, { onDelete: "cascade" }),
  glCode: varchar("gl_code", { length: 20 }),
  glGroup: varchar("gl_group", { length: 40 }),
  glSubgroup: varchar("gl_subgroup", { length: 60 }).default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

module.exports = { expenseCategoryExtras };
