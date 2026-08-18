const { bigint, serial, timestamp, index, uniqueIndex } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { consumerDepots } = require("../consumerDepots");
const { administrationUser } = require("../administrationUser");

const depotStaff = smanSchema.table(
  "depot_staff",
  {
    id: serial("id").primaryKey(),
    depotId: bigint("depot_id", { mode: "number" })
      .notNull()
      .references(() => consumerDepots.id, { onDelete: "cascade" }),
    staffId: bigint("staff_id", { mode: "number" })
      .notNull()
      .references(() => administrationUser.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("depot_staff_unique_idx").on(table.depotId, table.staffId),
    index("depot_staff_depot_idx").on(table.depotId),
    index("depot_staff_staff_idx").on(table.staffId),
  ]
);

module.exports = { depotStaff };
