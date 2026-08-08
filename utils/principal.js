const { eq } = require("drizzle-orm");

/**
 * Helpers for the tables that carry a staff/customer exclusive arc
 * (sessions, notifications, device_tokens, notification_preferences,
 * notification_settings).
 *
 * A "principal" is `{ type: "staff" | "customer", id: number }` — the one
 * shape the notification engine passes around instead of two nullable ids.
 * Building the arc columns in a single place is what stops the classic bug:
 * setting `principalType: "staff"` while filling `customerId`, which the CHECK
 * rejects at 3 a.m. in whichever code path forgot.
 */

const STAFF = "staff";
const CUSTOMER = "customer";

const isPrincipal = (p) =>
  !!p && (p.type === STAFF || p.type === CUSTOMER) && Number.isInteger(Number(p.id)) && Number(p.id) > 0;

/** Normalise into a principal, or null if it isn't one. */
const toPrincipal = (type, id) => {
  const p = { type, id: Number(id) };
  return isPrincipal(p) ? p : null;
};

/** A stable string key — SSE subscriber maps, dedupe keys, log lines. */
const principalKey = ({ type, id }) => `${type}:${id}`;

/**
 * The arc columns for an INSERT. `column` names the discriminator, which is
 * `recipient_type` on notifications and `principal_type` everywhere else.
 */
const principalValues = ({ type, id }, column = "principalType") => ({
  [column]: type,
  staffId: type === STAFF ? Number(id) : null,
  customerId: type === CUSTOMER ? Number(id) : null,
});

/**
 * The WHERE clause scoping a query to one principal. Only the populated side
 * of the arc is tested — the discriminator is redundant given the CHECK, and
 * leaving it out lets the partial indexes serve the query.
 */
const principalWhere = (table, { type, id }) =>
  type === STAFF ? eq(table.staffId, Number(id)) : eq(table.customerId, Number(id));

module.exports = {
  STAFF,
  CUSTOMER,
  isPrincipal,
  toPrincipal,
  principalKey,
  principalValues,
  principalWhere,
};
