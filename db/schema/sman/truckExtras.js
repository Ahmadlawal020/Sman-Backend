const { bigint, varchar, integer, date, timestamp } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { consumerFleettruck } = require("../consumerFleettruck");

/**
 * consumer_fleettruck (the live row, canonical) covers plate/driver/capacity/
 * status/mileage/insurance/road-worthiness/service-date — but the truck
 * management screen also collects vin, year, a separate truck "type" (distinct
 * from truck_make), a live fuel-level reading, a registration expiry (distinct
 * from road-worthiness), and a mileage-based (not date-based) next-service
 * threshold — none of which consumer_fleettruck has a column for. Kept exactly
 * as the old clean-room `trucks` table had them, 1:1 keyed to the live truck.
 *
 * The current driver is NOT duplicated here — see sman/driver.js's
 * `assignedTruckId`, the single source of truth for that relationship.
 */
const truckExtras = smanSchema.table("truck_extras", {
  truckId: bigint("truck_id", { mode: "number" })
    .primaryKey()
    .references(() => consumerFleettruck.id, { onDelete: "cascade" }),
  vin: varchar("vin", { length: 50 }).default(""),
  year: integer("year"),
  truckType: varchar("truck_type", { length: 50 }).default(""),
  fuelLevel: integer("fuel_level").default(100),
  registrationExpiry: date("registration_expiry"),
  nextServiceMileage: integer("next_service_mileage"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

module.exports = { truckExtras };
