const {
  bigint,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} = require("drizzle-orm/pg-core");
const { smanSchema, customerIdentityProviderEnum } = require("./enums");
const { consumerCustomer } = require("../consumerCustomer");

// One customer, many ways to sign in. The phone identity lives on
// consumer_customer itself; everything else — email+password, Google, Apple,
// PIN — is a row here. Passkeys get their own table below because one
// customer holds many credentials.
//
// The (provider, provider_user_id) unique index is what prevents duplicate
// accounts: a Google sub or an email can belong to exactly one customer.
const customerIdentities = smanSchema.table(
  "customer_identities",
  {
    id: serial("id").primaryKey(),
    customerId: bigint("customer_id", { mode: "number" })
      .notNull()
      .references(() => consumerCustomer.id, { onDelete: "cascade" }),
    provider: customerIdentityProviderEnum("provider").notNull(),
    // email address (lowercased) for email; OAuth `sub` for google/apple;
    // the customer id itself for pin.
    providerUserId: varchar("provider_user_id", { length: 320 }).notNull(),
    // bcrypt hash — the password for email, the PIN for pin, null for OAuth.
    secretHash: text("secret_hash"),
    verified: boolean("verified").default(false).notNull(),
    failedAttempts: integer("failed_attempts").default(0).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    // Display data from the provider (name, email, picture) — never trusted
    // for authorization.
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("customer_identities_provider_uid_idx").on(table.provider, table.providerUserId),
    uniqueIndex("customer_identities_customer_provider_idx").on(table.customerId, table.provider),
  ]
);

// A device the customer has proven with an OTP once; afterwards password or
// PIN alone signs in from it. The client holds the raw token; only its
// SHA-256 lands here.
const customerTrustedDevices = smanSchema.table(
  "customer_trusted_devices",
  {
    id: serial("id").primaryKey(),
    customerId: bigint("customer_id", { mode: "number" })
      .notNull()
      .references(() => consumerCustomer.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    deviceName: varchar("device_name", { length: 255 }).default(""),
    userAgent: varchar("user_agent", { length: 512 }).default(""),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("customer_trusted_devices_token_idx").on(table.tokenHash),
    index("customer_trusted_devices_customer_idx").on(table.customerId),
  ]
);

// WebAuthn credentials (passkeys). Multiple per customer — one per device or
// password manager.
const customerPasskeys = smanSchema.table(
  "customer_passkeys",
  {
    id: serial("id").primaryKey(),
    customerId: bigint("customer_id", { mode: "number" })
      .notNull()
      .references(() => consumerCustomer.id, { onDelete: "cascade" }),
    credentialId: varchar("credential_id", { length: 512 }).notNull(),
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).default(0).notNull(),
    transports: jsonb("transports"),
    deviceName: varchar("device_name", { length: 255 }).default(""),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("customer_passkeys_credential_idx").on(table.credentialId),
    index("customer_passkeys_customer_idx").on(table.customerId),
  ]
);

// One-shot WebAuthn challenges. customer_id is null for login ceremonies
// (discoverable credentials — we don't yet know who is signing in).
const webauthnChallenges = smanSchema.table(
  "webauthn_challenges",
  {
    id: serial("id").primaryKey(),
    customerId: bigint("customer_id", { mode: "number" }).references(() => consumerCustomer.id, {
      onDelete: "cascade",
    }),
    purpose: varchar("purpose", { length: 20 }).notNull(),
    challenge: varchar("challenge", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("webauthn_challenges_challenge_idx").on(table.challenge),
    index("webauthn_challenges_expires_idx").on(table.expiresAt),
  ]
);

module.exports = {
  customerIdentities,
  customerTrustedDevices,
  customerPasskeys,
  webauthnChallenges,
};
