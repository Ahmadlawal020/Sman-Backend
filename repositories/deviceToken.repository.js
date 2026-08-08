const { eq, and, isNull, ne, sql, inArray, lt, desc } = require("drizzle-orm");
const { db } = require("../config/db");
const { deviceTokens } = require("../db/schema");
const { principalValues, principalWhere } = require("../utils/principal");

/**
 * Push registrations. The interesting operations are all about NOT accumulating
 * dead tokens — a table full of stale FCM tokens is a table full of wasted
 * sends and misdirected notifications.
 */

/**
 * Register (or re-register) a device for a principal.
 *
 * The token is the conflict target because FCM hands the same token back to
 * whoever installs on that handset. Re-registering therefore MOVES the row to
 * the current principal and revives it — the previous owner stops receiving
 * notifications on a device they no longer hold, which is the whole point.
 *
 * Separately, when the app supplies a stable `deviceId`, any OTHER token
 * previously registered for that same device is retired: an app whose FCM token
 * rotates would otherwise leave one live-looking row behind per rotation, and
 * every send would fan out to a growing pile of dead tokens.
 */
const register = async (principal, { token, platform, provider = "fcm", deviceId = "", deviceName = "", appVersion = "", locale = "", timezone = "" }) => {
  const now = new Date();

  const [row] = await db
    .insert(deviceTokens)
    .values({
      ...principalValues(principal),
      token,
      provider,
      platform,
      deviceId,
      deviceName,
      appVersion,
      locale,
      timezone,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: deviceTokens.token,
      set: {
        ...principalValues(principal),
        provider,
        platform,
        deviceId,
        deviceName,
        appVersion,
        locale,
        timezone,
        lastSeenAt: now,
        // Reviving: a token that reappears from a live app is live again,
        // whatever the send path concluded last time.
        failureCount: 0,
        disabledAt: null,
        disabledReason: null,
        updatedAt: now,
      },
    })
    .returning();

  if (deviceId) {
    await db
      .update(deviceTokens)
      .set({ disabledAt: now, disabledReason: "replaced", updatedAt: now })
      .where(
        and(
          eq(deviceTokens.deviceId, deviceId),
          ne(deviceTokens.token, token),
          isNull(deviceTokens.disabledAt)
        )
      );
  }

  return row;
};

/** Every live token for a principal — the push channel's fan-out list. */
const findLiveForPrincipal = async (principal) => {
  return db
    .select()
    .from(deviceTokens)
    .where(and(principalWhere(deviceTokens, principal), isNull(deviceTokens.disabledAt)))
    .orderBy(desc(deviceTokens.lastSeenAt));
};

/** Live tokens for many principals at once, grouped by principal id. */
const findLiveForPrincipals = async (type, ids) => {
  if (!ids.length) return new Map();
  const column = type === "staff" ? deviceTokens.staffId : deviceTokens.customerId;

  const rows = await db
    .select()
    .from(deviceTokens)
    .where(and(inArray(column, ids.map(Number)), isNull(deviceTokens.disabledAt)));

  const grouped = new Map();
  for (const row of rows) {
    const key = type === "staff" ? row.staffId : row.customerId;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
};

/** Devices screen: what the principal sees under "where you're signed in". */
const listForPrincipal = async (principal, { includeDisabled = false } = {}) => {
  const conditions = [principalWhere(deviceTokens, principal)];
  if (!includeDisabled) conditions.push(isNull(deviceTokens.disabledAt));

  return db
    .select({
      id: deviceTokens.id,
      platform: deviceTokens.platform,
      provider: deviceTokens.provider,
      deviceId: deviceTokens.deviceId,
      deviceName: deviceTokens.deviceName,
      appVersion: deviceTokens.appVersion,
      locale: deviceTokens.locale,
      timezone: deviceTokens.timezone,
      lastSeenAt: deviceTokens.lastSeenAt,
      disabledAt: deviceTokens.disabledAt,
      disabledReason: deviceTokens.disabledReason,
      createdAt: deviceTokens.createdAt,
    })
    .from(deviceTokens)
    .where(and(...conditions))
    .orderBy(desc(deviceTokens.lastSeenAt));
};

/** Sign-out: retire this device's token, scoped so nobody can retire another's. */
const unregister = async (principal, token) => {
  const rows = await db
    .update(deviceTokens)
    .set({ disabledAt: new Date(), disabledReason: "logout", updatedAt: new Date() })
    .where(
      and(
        principalWhere(deviceTokens, principal),
        eq(deviceTokens.token, token),
        isNull(deviceTokens.disabledAt)
      )
    )
    .returning({ id: deviceTokens.id });
  return rows.length > 0;
};

/** Sign-out-everywhere / deactivation: retire every device for a principal. */
const unregisterAll = async (principal, reason = "logout") => {
  const rows = await db
    .update(deviceTokens)
    .set({ disabledAt: new Date(), disabledReason: reason, updatedAt: new Date() })
    .where(and(principalWhere(deviceTokens, principal), isNull(deviceTokens.disabledAt)))
    .returning({ id: deviceTokens.id });
  return rows.length;
};

/**
 * The provider says this token is gone (UNREGISTERED / INVALID_ARGUMENT).
 * That verdict is final, so the row is retired immediately — no failure
 * counting, because retrying a token FCM has forgotten never succeeds.
 */
const disableToken = async (token, reason = "unregistered") => {
  await db
    .update(deviceTokens)
    .set({ disabledAt: new Date(), disabledReason: reason, updatedAt: new Date() })
    .where(and(eq(deviceTokens.token, token), isNull(deviceTokens.disabledAt)));
};

/**
 * A transient send failure. Counted rather than acted on: network blips and
 * FCM 5xx are not evidence a device is gone. Only a sustained run retires it,
 * so one bad afternoon at Google does not unregister the fleet.
 */
const recordFailure = async (token, threshold = 10) => {
  const [row] = await db
    .update(deviceTokens)
    .set({ failureCount: sql`${deviceTokens.failureCount} + 1`, updatedAt: new Date() })
    .where(eq(deviceTokens.token, token))
    .returning({ id: deviceTokens.id, failureCount: deviceTokens.failureCount });

  if (row && row.failureCount >= threshold) {
    await disableToken(token, "invalid");
  }
  return row || null;
};

const recordSuccess = async (token) => {
  await db
    .update(deviceTokens)
    .set({ failureCount: 0, lastSeenAt: new Date(), updatedAt: new Date() })
    .where(eq(deviceTokens.token, token));
};

/**
 * Housekeeping: drop rows disabled long enough that nobody is investigating
 * them any more. Live tokens are never touched, however quiet.
 */
const purgeDisabledBefore = async (cutoff) => {
  const rows = await db
    .delete(deviceTokens)
    .where(and(lt(deviceTokens.disabledAt, cutoff), sql`${deviceTokens.disabledAt} IS NOT NULL`))
    .returning({ id: deviceTokens.id });
  return rows.length;
};

module.exports = {
  register,
  findLiveForPrincipal,
  findLiveForPrincipals,
  listForPrincipal,
  unregister,
  unregisterAll,
  disableToken,
  recordFailure,
  recordSuccess,
  purgeDisabledBefore,
};
