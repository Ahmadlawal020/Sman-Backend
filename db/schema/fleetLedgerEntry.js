const {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  decimal,
  date,
  timestamp,
  index,
  check,
} = require("drizzle-orm/pg-core");
const { sql } = require("drizzle-orm");
const { fleetEntryTypeEnum } = require("./enums");
const { fleetTrucks } = require("./fleetTruck");
const { staff } = require("./staff");

// Expense / income tracking per fleet truck — the same ledger the Django
// FleetLedgerEntry model kept, so the fleet screens carry over unchanged.
// Append-only by convention: the repository exposes no update or delete.
const fleetLedgerEntries = pgTable(
  "fleet_ledger_entries",
  {
    id: serial("id").primaryKey(),
    truckId: integer("truck_id")
      .notNull()
      .references(() => fleetTrucks.id, { onDelete: "cascade" }),
    entryType: fleetEntryTypeEnum("entry_type").notNull(),
    // Free text, matching the existing workflow: Fuel, Repairs, Tyres,
    // Maintenance, Driver Allowance, Tolls, Insurance, Registration, ...
    category: varchar("category", { length: 100 }).notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
    entryDate: date("entry_date").notNull(),
    description: text("description").default(""),
    enteredBy: varchar("entered_by", { length: 255 }).default(""),
    recordedBy: integer("recorded_by").references(() => staff.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("fleet_ledger_truck_date_idx").on(table.truckId, table.entryDate),
    index("fleet_ledger_category_idx").on(table.category),
    check("fleet_ledger_amount_check", sql`${table.amount} > 0`),
  ]
);

module.exports = { fleetLedgerEntries };
