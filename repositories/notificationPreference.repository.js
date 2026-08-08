const { eq, and, inArray, isNotNull } = require("drizzle-orm");
const { db } = require("../config/db");
const { notificationPreferences, notificationSettings } = require("../db/schema");
const { principalValues, principalWhere } = require("../utils/principal");

/**
 * Preferences and settings. Both tables store DEVIATIONS from the defaults —
 * absence of a row means "the defaults are fine" — so a principal who never
 * opens the settings screen costs nothing and a new category ships working
 * without a backfill.
 */

// ─── Per-category channel toggles ───────────────────────────────────────────

const findAll = async (principal) => {
  return db
    .select()
    .from(notificationPreferences)
    .where(principalWhere(notificationPreferences, principal));
};

/** Keyed by category, for the engine's O(1) lookup during fan-out. */
const findAllAsMap = async (principal) => {
  const rows = await findAll(principal);
  return rows.reduce((acc, row) => {
    acc[row.category] = row;
    return acc;
  }, {});
};

/** Preferences for many principals at once — one query per broadcast, not N. */
const findForPrincipals = async (type, ids) => {
  if (!ids.length) return new Map();
  const column = type === "staff" ? notificationPreferences.staffId : notificationPreferences.customerId;

  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(inArray(column, ids.map(Number)));

  const grouped = new Map();
  for (const row of rows) {
    const key = type === "staff" ? row.staffId : row.customerId;
    if (!grouped.has(key)) grouped.set(key, {});
    grouped.get(key)[row.category] = row;
  }
  return grouped;
};

/**
 * Set the toggles for one category. Partial: only the channels named in
 * `channels` move, so a client sending `{ push: false }` does not silently
 * reset email and SMS to their defaults.
 */
const upsert = async (principal, category, channels = {}) => {
  const patch = {};
  for (const key of ["inApp", "push", "email", "sms"]) {
    if (typeof channels[key] === "boolean") patch[key] = channels[key];
  }

  const now = new Date();
  const [row] = await db
    .insert(notificationPreferences)
    .values({
      ...principalValues(principal),
      category,
      // Unnamed channels start from the permissive default on first write.
      inApp: patch.inApp ?? true,
      push: patch.push ?? true,
      email: patch.email ?? true,
      sms: patch.sms ?? true,
    })
    .onConflictDoUpdate({
      // Target columns AND predicate must match the partial unique index for
      // Postgres to infer it — this repeats the index's own `IS NOT NULL`
      // predicate rather than a narrower `= id`, which would only work by way
      // of the planner's implication prover.
      target:
        principal.type === "staff"
          ? [notificationPreferences.staffId, notificationPreferences.category]
          : [notificationPreferences.customerId, notificationPreferences.category],
      targetWhere:
        principal.type === "staff"
          ? isNotNull(notificationPreferences.staffId)
          : isNotNull(notificationPreferences.customerId),
      set: { ...patch, updatedAt: now },
    })
    .returning();

  return row;
};

/** Apply several categories in one call — what the settings screen saves. */
const upsertMany = async (principal, entries = []) => {
  const saved = [];
  for (const { category, ...channels } of entries) {
    saved.push(await upsert(principal, category, channels));
  }
  return saved;
};

/** Back to catalog defaults: delete the deviation rows rather than rewrite them. */
const reset = async (principal, { category } = {}) => {
  const conditions = [principalWhere(notificationPreferences, principal)];
  if (category) conditions.push(eq(notificationPreferences.category, category));

  const rows = await db
    .delete(notificationPreferences)
    .where(and(...conditions))
    .returning({ id: notificationPreferences.id });
  return rows.length;
};

// ─── Per-principal settings (master switches, quiet hours) ──────────────────

const getSettings = async (principal) => {
  const [row] = await db
    .select()
    .from(notificationSettings)
    .where(principalWhere(notificationSettings, principal))
    .limit(1);
  return row || null;
};

/** Settings for many principals at once, keyed by principal id. */
const getSettingsForPrincipals = async (type, ids) => {
  if (!ids.length) return new Map();
  const column = type === "staff" ? notificationSettings.staffId : notificationSettings.customerId;

  const rows = await db
    .select()
    .from(notificationSettings)
    .where(inArray(column, ids.map(Number)));

  return new Map(rows.map((row) => [type === "staff" ? row.staffId : row.customerId, row]));
};

const SETTINGS_FIELDS = [
  "pushEnabled",
  "emailEnabled",
  "smsEnabled",
  "quietHoursEnabled",
  "quietHoursStart",
  "quietHoursEnd",
  "timezone",
  "locale",
];

/** Partial update, same reasoning as `upsert` above. */
const upsertSettings = async (principal, patch = {}) => {
  const changes = {};
  for (const key of SETTINGS_FIELDS) {
    if (patch[key] !== undefined) changes[key] = patch[key];
  }

  const now = new Date();
  const [row] = await db
    .insert(notificationSettings)
    .values({ ...principalValues(principal), ...changes })
    .onConflictDoUpdate({
      target:
        principal.type === "staff" ? notificationSettings.staffId : notificationSettings.customerId,
      targetWhere:
        principal.type === "staff"
          ? isNotNull(notificationSettings.staffId)
          : isNotNull(notificationSettings.customerId),
      set: { ...changes, updatedAt: now },
    })
    .returning();

  return row;
};

module.exports = {
  findAll,
  findAllAsMap,
  findForPrincipals,
  upsert,
  upsertMany,
  reset,
  getSettings,
  getSettingsForPrincipals,
  upsertSettings,
};
