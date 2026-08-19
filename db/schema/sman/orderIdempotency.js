const { serial, varchar, bigint, timestamp, uniqueIndex } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");

/**
 * Backs placeOrder's idempotency-key replay path (order.service.js). Django's
 * own order_fingerprint column on consumer_order carries the same value for
 * visibility, but it has only a plain (non-unique) index — see
 * docs/live_schema.sql's consumer_order_order_fingerprint_18d15027 index —
 * so it cannot itself stop two concurrent requests with the same key from
 * both creating an order (never true DDL access to public. anyway). This
 * table's unique index is what actually gives "the same key twice returns
 * the first order" its atomicity: the loser's insert throws 23505, which
 * placeOrder's isIdempotencyConflict catches to look up and return the
 * winner's order instead of a duplicate.
 */
const orderIdempotency = smanSchema.table(
  "order_idempotency",
  {
    id: serial("id").primaryKey(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    orderId: bigint("order_id", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("order_idempotency_key_idx").on(table.idempotencyKey)]
);

module.exports = { orderIdempotency };
