const {
  pgTable,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} = require("drizzle-orm/pg-core");
const { lpgStations } = require("./lpgStation");
const { staff } = require("./staff");

const lpgStationStaff = pgTable(
  "lpg_station_staff",
  {
    id: serial("id").primaryKey(),
    lpgStationId: integer("lpg_station_id")
      .notNull()
      .references(() => lpgStations.id, { onDelete: "cascade" }),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("lpg_station_staff_unique_idx").on(table.lpgStationId, table.staffId),
    index("lpg_station_staff_station_idx").on(table.lpgStationId),
    index("lpg_station_staff_staff_idx").on(table.staffId),
  ]
);

module.exports = { lpgStationStaff };
