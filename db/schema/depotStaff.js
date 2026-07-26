const {
  pgTable,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} = require("drizzle-orm/pg-core");
const { depots } = require("./depot");
const { staff } = require("./staff");

const depotStaff = pgTable(
  "depot_staff",
  {
    id: serial("id").primaryKey(),
    depotId: integer("depot_id")
      .notNull()
      .references(() => depots.id, { onDelete: "cascade" }),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("depot_staff_unique_idx").on(table.depotId, table.staffId),
    index("depot_staff_depot_idx").on(table.depotId),
    index("depot_staff_staff_idx").on(table.staffId),
  ]
);

module.exports = { depotStaff };
