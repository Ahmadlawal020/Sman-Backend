const {
  pgTable,
  serial,
  integer,
  timestamp,
  index,
} = require("drizzle-orm/pg-core");
const { drivers } = require("./driver");
const { fleetTrucks } = require("./fleetTruck");

const driverTruckHistory = pgTable(
  "driver_truck_history",
  {
    id: serial("id").primaryKey(),
    driverId: integer("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "cascade" }),
    truckId: integer("truck_id")
      .notNull()
      .references(() => fleetTrucks.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("driver_truck_history_driver_idx").on(table.driverId),
    index("driver_truck_history_truck_idx").on(table.truckId),
  ]
);

module.exports = { driverTruckHistory };
