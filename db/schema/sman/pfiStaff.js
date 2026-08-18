const { bigint, serial, timestamp, index, uniqueIndex } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { consumerPfi } = require("../consumerPfi");
const { administrationUser } = require("../administrationUser");

// No live counterpart — same story as depot_staff (see sman/depotStaff.js).
const pfiStaff = smanSchema.table(
  "pfi_staff",
  {
    id: serial("id").primaryKey(),
    pfiId: bigint("pfi_id", { mode: "number" })
      .notNull()
      .references(() => consumerPfi.id, { onDelete: "cascade" }),
    staffId: bigint("staff_id", { mode: "number" })
      .notNull()
      .references(() => administrationUser.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("pfi_staff_unique_idx").on(table.pfiId, table.staffId),
    index("pfi_staff_pfi_idx").on(table.pfiId),
    index("pfi_staff_staff_idx").on(table.staffId),
  ]
);

module.exports = { pfiStaff };
