const { bigint, serial, integer, timestamp, index } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { drivers } = require("./driver");
const { consumerFleettruck } = require("../consumerFleettruck");

const driverTruckHistory = smanSchema.table(
  "driver_truck_history",
  {
    id: serial("id").primaryKey(),
    driverId: integer("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "cascade" }),
    truckId: bigint("truck_id", { mode: "number" })
      .notNull()
      .references(() => consumerFleettruck.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("driver_truck_history_driver_idx").on(table.driverId),
    index("driver_truck_history_truck_idx").on(table.truckId),
  ]
);

module.exports = { driverTruckHistory };
