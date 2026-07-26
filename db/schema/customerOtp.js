const {
  pgTable,
  serial,
  integer,
  varchar,
  char,
  timestamp,
  index,
} = require("drizzle-orm/pg-core");
const { customers } = require("./customer");

/**
 * One-time codes for customer phone authentication.
 *
 * code_hash is SHA-256 over `customerId + ":" + code`, not bcrypt. A 6-digit
 * code has only 10^6 possibilities, so bcrypt buys nothing against an attacker
 * holding the database — but it *would* make the row un-lookupable by hash,
 * forcing a fetch-all-and-compare loop that makes attempt accounting ambiguous.
 * Domain-separating with customerId prevents cross-account rainbow reuse.
 *
 * Requesting a new code invalidates every prior unconsumed code for that
 * customer, so at most one is ever live.
 *
 * There is deliberately no `purpose` column. Verification is identical for the
 * register and login flows, and "was this a signup?" is already answerable from
 * customers.phone_verified_at IS NULL.
 */
const customerOtps = pgTable(
  "customer_otps",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .references(() => customers.id, { onDelete: "cascade" })
      .notNull(),
    codeHash: char("code_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    requestIp: varchar("request_ip", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("customer_otps_lookup_idx").on(table.customerId, table.createdAt),
    // Serves both the expiry sweep and the daily send cap, which counts rows
    // created since midnight rather than keeping a separate counter.
    index("customer_otps_sweep_idx").on(table.expiresAt),
    index("customer_otps_created_idx").on(table.createdAt),
  ]
);

module.exports = { customerOtps };
