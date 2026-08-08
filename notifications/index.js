const engine = require("./engine");
const catalog = require("./catalog");

/**
 * The notification engine's public front door.
 *
 *     const { notify } = require("../notifications");
 *     await notify("order.released", {
 *       to: { customerId: order.customerId },
 *       data: { orderId: order.id, reference, depotName },
 *     });
 *
 * That is the entire API business code needs. Which channels fire, what the
 * SMS says, whether the recipient muted the category, and how it is all logged
 * are decided downstream.
 *
 * TRANSPORT — two modes, one code path:
 *
 *   NOTIFY_QUEUE_ENABLED=true   the call enqueues a pg-boss job and returns
 *                               immediately; the worker dispatches. Survives a
 *                               deploy or a crash mid-send. Production.
 *   otherwise (default)         the call dispatches in the background of the
 *                               current process. No queue to run, which is
 *                               what dev and the test suite want.
 *
 * Both converge on engine.dispatch(), so behaviour is identical either way —
 * only durability differs.
 */

const isQueued = () => process.env.NOTIFY_QUEUE_ENABLED === "true";

/** The master kill switch. Off means nothing is written and nothing is sent. */
const isEnabled = () => process.env.NOTIFICATIONS_ENABLED !== "false";

/**
 * Fire a notification.
 *
 * NEVER THROWS. A notification is a side effect of an operation that has
 * already committed; letting it reject would turn a delivered order into a
 * failed request. Failures are logged and swallowed, exactly as the event bus
 * in services/events.js does.
 *
 * @param {string} type          a catalog key, e.g. "order.paid"
 * @param {object} opts
 * @param {object|Array} opts.to recipient spec(s): { customerId }, { staffId },
 *                               { roles: ["admin"] }, { allStaff: true },
 *                               { email, phone, name }, or an array of these
 * @param {object} [opts.data]   the fields this type's templates read
 * @param {string[]} [opts.channels] restrict to a subset of channels
 * @param {boolean} [opts.force] ignore preferences and quiet hours
 * @param {boolean} [opts.wait]  await the actual dispatch rather than
 *                               returning as soon as it is scheduled. Tests
 *                               use this; business code should not.
 */
const notify = async (type, opts = {}) => {
  if (!isEnabled()) return { skipped: true, reason: "Notifications are disabled" };
  if (!opts.to) {
    console.warn(`[notify] "${type}" called with no recipients`);
    return { skipped: true, reason: "No recipients" };
  }

  if (isQueued() && !opts.wait) {
    try {
      const { enqueue, QUEUES } = require("../config/queue");
      const jobId = await enqueue(QUEUES.NOTIFY_DISPATCH, { type, ...opts });
      return { queued: true, jobId };
    } catch (err) {
      // The queue is unreachable. Falling through to an inline dispatch is the
      // right trade: the notification loses its durability guarantee for this
      // one send, but it still reaches the customer. `enqueue` either returns
      // an id or throws, so nothing was queued and this cannot double-send.
      console.error(`[notify] enqueue failed for "${type}", sending inline:`, err.message);
    }
  }

  if (opts.wait) {
    try {
      return await engine.dispatch(type, opts);
    } catch (err) {
      console.error(`[notify] dispatch failed for "${type}":`, err.message);
      return { error: err.message };
    }
  }

  // Fire-and-forget. Deliberately not awaited: the caller is a controller that
  // has already done its real work, and it should answer the client now rather
  // than after four provider round trips.
  engine
    .dispatch(type, opts)
    .catch((err) => console.error(`[notify] dispatch failed for "${type}":`, err.message));

  return { dispatched: true };
};

/**
 * Send and wait, reporting exactly what each channel did.
 *
 * For the few callers that genuinely need the outcome — an admin "send test
 * notification" button, and the tests.
 */
const notifyAndWait = (type, opts = {}) => notify(type, { ...opts, wait: true });

module.exports = {
  notify,
  notifyAndWait,
  isEnabled,
  isQueued,
  dispatch: engine.dispatch,
  catalog,
};
