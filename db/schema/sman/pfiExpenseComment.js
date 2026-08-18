const { bigint, serial, text, varchar, timestamp, index } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { consumerPfiexpense } = require("../consumerPfiexpense");
const { administrationUser } = require("../administrationUser");

// pfi_expenses maps to consumer_pfiexpense, but the comment thread on a
// request has no live counterpart at all.
const pfiExpenseComments = smanSchema.table(
  "pfi_expense_comments",
  {
    id: serial("id").primaryKey(),
    expenseId: bigint("expense_id", { mode: "number" })
      .notNull()
      .references(() => consumerPfiexpense.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorId: bigint("author_id", { mode: "number" }).references(() => administrationUser.id, {
      onDelete: "set null",
    }),
    authorName: varchar("author_name", { length: 255 }).default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("pfi_expense_comments_expense_idx").on(table.expenseId, table.createdAt)]
);

module.exports = { pfiExpenseComments };
