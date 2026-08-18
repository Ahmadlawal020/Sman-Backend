const { bigint, serial, varchar, boolean, timestamp, index, uniqueIndex } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { administrationUser } = require("../administrationUser");

const staffPageOverrides = smanSchema.table(
  "staff_page_overrides",
  {
    id: serial("id").primaryKey(),
    staffId: bigint("staff_id", { mode: "number" })
      .notNull()
      .references(() => administrationUser.id, { onDelete: "cascade" }),
    routePath: varchar("route_path", { length: 100 }).notNull(),
    allowed: boolean("allowed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("staff_page_overrides_unique_idx").on(table.staffId, table.routePath),
    index("staff_page_overrides_staff_idx").on(table.staffId),
  ]
);

module.exports = { staffPageOverrides };
