const {
  pgTable,
  serial,
  varchar,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { truckStatusEnum } = require("./enums");

const trucks = pgTable(
  "trucks",
  {
    id: serial("id").primaryKey(),
    plateNumber: varchar("plate_number", { length: 30 }).notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    capacity: varchar("capacity", { length: 50 }).notNull(),
    status: truckStatusEnum("status").default("Idle").notNull(),
    currentDriverId: integer("driver_ref"),
    fuelLevel: integer("fuel_level").default(100),
    mileage: varchar("mileage", { length: 50 }).default("0 km"),
    vin: varchar("vin", { length: 50 }),
    year: integer("year"),
    make: varchar("make", { length: 100 }),
    type: varchar("type", { length: 100 }),
    insuranceExpiry: timestamp("insurance_expiry", { withTimezone: true }),
    registrationExpiry: timestamp("registration_expiry", { withTimezone: true }),
    nextServiceMileage: integer("next_service_mileage").default(15000),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("trucks_plate_number_idx").on(table.plateNumber),
    index("trucks_status_idx").on(table.status),
    index("trucks_driver_idx").on(table.currentDriverId),
    check("trucks_fuel_level_check", sql`${table.fuelLevel} >= 0 AND ${table.fuelLevel} <= 100`),
  ]
);

module.exports = { trucks };
