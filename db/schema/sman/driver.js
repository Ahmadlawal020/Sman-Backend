const { serial, varchar, integer, real, timestamp, index, uniqueIndex, check } = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { smanSchema, driverStatusEnum } = require("./enums");

// No live counterpart: soroman_db denormalises driver identity onto
// consumer_fleettruck (driver_name, driver_phone, spare_driver_*,
// motor_boy_*) and consumer_truckticket (driver_name, driver_phone,
// entry_driver_*) instead of a driver table. assignedTruckId intentionally
// carries no FK, matching the original design — it was never enforced even
// when fleet_trucks lived in this same schema.
const drivers = smanSchema.table(
  "drivers",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).default(""),
    phone: varchar("phone", { length: 30 }).notNull(),
    licenseNumber: varchar("license_number", { length: 100 }).notNull(),
    licenseClass: varchar("license_class", { length: 50 }).notNull(),
    rating: real("rating").default(0),
    status: driverStatusEnum("status").default("Active").notNull(),
    assignedTruckId: integer("assigned_truck_ref"),
    safetyScore: integer("safety_score").default(0),
    licenseExpiry: timestamp("license_expiry", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("drivers_license_number_idx").on(table.licenseNumber),
    index("drivers_status_idx").on(table.status),
    index("drivers_truck_idx").on(table.assignedTruckId),
    check("drivers_rating_check", sql`${table.rating} >= 0 AND ${table.rating} <= 5`),
    check("drivers_safety_score_check", sql`${table.safetyScore} >= 0 AND ${table.safetyScore} <= 100`),
  ]
);

module.exports = { drivers };
