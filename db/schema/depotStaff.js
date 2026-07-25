const {
  pgTable,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} = require("drizzle-orm/pg-core");
const { depots } = require("./depot");
const { admins } = require("./admin");

const depotStaff = pgTable(
  "depot_staff",
  {
    id: serial("id").primaryKey(),
    depotId: integer("depot_id")
      .notNull()
      .references(() => depots.id, { onDelete: "cascade" }),
    adminId: integer("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("depot_staff_unique_idx").on(table.depotId, table.adminId),
    index("depot_staff_depot_idx").on(table.depotId),
    index("depot_staff_admin_idx").on(table.adminId),
  ]
);

module.exports = { depotStaff };
