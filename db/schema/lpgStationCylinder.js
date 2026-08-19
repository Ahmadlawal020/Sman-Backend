const {
  pgTable,
  serial,
  integer,
  timestamp,
  index,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { lpgStations } = require("./lpgStation");

const lpgStationCylinders = pgTable(
  "lpg_station_cylinders",
  {
    id: serial("id").primaryKey(),
    lpgStationId: integer("lpg_station_id")
      .notNull()
      .references(() => lpgStations.id, { onDelete: "cascade" }),
    cylinderSizeKg: integer("cylinder_size_kg").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("lpg_station_cylinders_station_idx").on(table.lpgStationId),
    check("lpg_station_cylinders_size_check", sql`${table.cylinderSizeKg} >= 1`),
    check("lpg_station_cylinders_qty_check", sql`${table.quantity} >= 1`),
  ]
);

module.exports = { lpgStationCylinders };
