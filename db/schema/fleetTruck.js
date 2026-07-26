const {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  real,
  boolean,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { staff } = require("./staff");

// Fleet registry — the company's own tanker fleet, distinct from the ops
// `trucks` table (third-party/loading trucks). Financials live in the
// ledger engine (owner_type fleet_truck), never as mutable columns here.
const fleetTrucks = pgTable(
  "fleet_trucks",
  {
    id: serial("id").primaryKey(),
    plateNumber: varchar("plate_number", { length: 50 }).notNull(),
    truckMake: varchar("truck_make", { length: 255 }).default(""),
    chassisNumber: varchar("chassis_number", { length: 255 }).default(""),
    maxCapacity: integer("max_capacity"),
    fuelCapacity: real("fuel_capacity"),
    avgLitresPerTrip: real("avg_litres_per_trip"),
    mileage: integer("mileage"),

    driverName: varchar("driver_name", { length: 255 }).default(""),
    driverPhone: varchar("driver_phone", { length: 50 }).default(""),
    driverAltPhone: varchar("driver_alt_phone", { length: 50 }).default(""),
    motorBoyName: varchar("motor_boy_name", { length: 255 }).default(""),
    motorBoyPhone: varchar("motor_boy_phone", { length: 50 }).default(""),
    spareDriverName: varchar("spare_driver_name", { length: 255 }).default(""),
    spareDriverPhone: varchar("spare_driver_phone", { length: 50 }).default(""),

    insuranceExpiry: date("insurance_expiry"),
    roadWorthinessExpiry: date("road_worthiness_expiry"),
    lastServiceDate: date("last_service_date"),
    nextServiceDate: date("next_service_date"),

    // [{ kind: "insurance_cert" | "vehicle_papers" | "drivers_license" | ...,
    //    name, url, uploadedAt }] — URLs/data-URIs, storage-agnostic.
    documents: jsonb("documents").default(sql`'[]'::jsonb`),

    passportPhoto: text("passport_photo").default(""),
    truckStatus: varchar("truck_status", { length: 500 }).default(""),
    isActive: boolean("is_active").default(true).notNull(),
    notes: text("notes").default(""),

    createdBy: integer("created_by").references(() => staff.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("fleet_trucks_plate_idx").on(table.plateNumber),
    index("fleet_trucks_active_idx").on(table.isActive),
    check("fleet_trucks_mileage_check", sql`${table.mileage} IS NULL OR ${table.mileage} >= 0`),
  ]
);

// Trip history: one row per journey, carrying mileage and fuel so fleet
// reporting can derive consumption without touching the truck row.
const fleetTrips = pgTable(
  "fleet_trips",
  {
    id: serial("id").primaryKey(),
    fleetTruckId: integer("fleet_truck_id")
      .notNull()
      .references(() => fleetTrucks.id, { onDelete: "restrict" }),
    tripDate: date("trip_date").notNull(),
    origin: varchar("origin", { length: 255 }).default(""),
    destination: varchar("destination", { length: 255 }).default(""),
    allocationCode: varchar("allocation_code", { length: 100 }).default(""),
    quantityLitres: real("quantity_litres"),
    fuelUsedLitres: real("fuel_used_litres"),
    mileageStart: integer("mileage_start"),
    mileageEnd: integer("mileage_end"),
    driverName: varchar("driver_name", { length: 255 }).default(""),
    notes: text("notes").default(""),
    createdBy: integer("created_by").references(() => staff.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("fleet_trips_truck_date_idx").on(table.fleetTruckId, table.tripDate),
    check(
      "fleet_trips_mileage_check",
      sql`${table.mileageEnd} IS NULL OR ${table.mileageStart} IS NULL OR ${table.mileageEnd} >= ${table.mileageStart}`
    ),
  ]
);

module.exports = { fleetTrucks, fleetTrips };
