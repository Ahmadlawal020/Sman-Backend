const { bigint, serial, timestamp, index, uniqueIndex } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { consumerLpgplant } = require("../consumerLpgplant");
const { administrationUser } = require("../administrationUser");

// No live counterpart — same story as depot_staff (see sman/depotStaff.js).
const lpgStationStaff = smanSchema.table(
  "lpg_station_staff",
  {
    id: serial("id").primaryKey(),
    lpgStationId: bigint("lpg_station_id", { mode: "number" })
      .notNull()
      .references(() => consumerLpgplant.id, { onDelete: "cascade" }),
    staffId: bigint("staff_id", { mode: "number" })
      .notNull()
      .references(() => administrationUser.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("lpg_station_staff_unique_idx").on(table.lpgStationId, table.staffId),
    index("lpg_station_staff_station_idx").on(table.lpgStationId),
    index("lpg_station_staff_staff_idx").on(table.staffId),
  ]
);

module.exports = { lpgStationStaff };
