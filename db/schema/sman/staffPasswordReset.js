const { bigint, serial, varchar, timestamp, index, uniqueIndex } = require("drizzle-orm/pg-core");
const { smanSchema } = require("./enums");
const { administrationUser } = require("../administrationUser");

// administration_user has no password-reset-token storage at all — Django's
// own password reset flow (if any) is out of band. This mirrors the old
// staff.passwordResetToken/passwordResetExpires columns as their own table.
const staffPasswordResets = smanSchema.table(
  "staff_password_resets",
  {
    id: serial("id").primaryKey(),
    staffId: bigint("staff_id", { mode: "number" })
      .notNull()
      .references(() => administrationUser.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("staff_password_resets_token_idx").on(table.tokenHash),
    index("staff_password_resets_staff_idx").on(table.staffId),
  ]
);

module.exports = { staffPasswordResets };
