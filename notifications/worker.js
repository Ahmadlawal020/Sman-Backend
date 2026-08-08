const { registerWorker, scheduleCron, QUEUES } = require("../config/queue");
const engine = require("./engine");
const notificationRepo = require("../repositories/notification.repository");
const notificationDeliveryRepo = require("../repositories/notificationDelivery.repository");
const deviceTokenRepo = require("../repositories/deviceToken.repository");

/**
 * The durable side of the engine: a worker that turns queued notify() calls
 * into real sends, and a nightly sweep that stops the tables growing forever.
 *
 * Started from server.js only when NOTIFY_QUEUE_ENABLED=true. Without it,
 * notifications dispatch in-process and nothing here runs — which is the right
 * default for dev and tests, where there is no queue to consume from.
 */

const days = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/**
 * Retention. The three tables age out on different clocks because they answer
 * different questions:
 *
 *   notifications  — the recipient's own history. Kept longest, and only ever
 *                    swept once READ or ARCHIVED (see the repository).
 *   deliveries     — an operational log. Useful for weeks, not years.
 *   device tokens  — only the rows already retired; live tokens are untouched
 *                    however quiet the device has been.
 */
const runMaintenance = async () => {
  const notificationDays = Number(process.env.NOTIFY_RETENTION_DAYS || 180);
  const deliveryDays = Number(process.env.NOTIFY_DELIVERY_RETENTION_DAYS || 60);
  const tokenDays = Number(process.env.NOTIFY_DEAD_TOKEN_RETENTION_DAYS || 60);

  const [notifications, deliveries, tokens] = await Promise.all([
    notificationRepo.purgeOlderThan(days(notificationDays)).catch((err) => {
      console.error("[notify] notification purge failed:", err.message);
      return 0;
    }),
    notificationDeliveryRepo.purgeOlderThan(days(deliveryDays)).catch((err) => {
      console.error("[notify] delivery purge failed:", err.message);
      return 0;
    }),
    deviceTokenRepo.purgeDisabledBefore(days(tokenDays)).catch((err) => {
      console.error("[notify] device token purge failed:", err.message);
      return 0;
    }),
  ]);

  console.log(
    `[notify] maintenance: purged ${notifications} notification(s), ` +
      `${deliveries} delivery log(s), ${tokens} dead device token(s)`
  );
  return { notifications, deliveries, tokens };
};

/**
 * Consume one fan-out job.
 *
 * Throwing hands the job back to pg-boss for retry with backoff. That is safe
 * precisely because the inbox row's dedupe key is scoped per recipient: a
 * retry re-runs the fan-out, finds the row already there, and stops before
 * sending a second SMS to anyone who was reached on the first attempt.
 */
const handleDispatch = async (job) => {
  const { type, ...opts } = job;
  if (!type) {
    // Nothing retryable about a malformed job — returning lets pg-boss
    // complete it instead of cycling it to the dead-letter queue.
    console.error("[notify] dispatch job has no type; discarding:", JSON.stringify(job).slice(0, 200));
    return { skipped: true };
  }
  return engine.dispatch(type, opts);
};

let started = false;

const start = async () => {
  if (started) return;
  started = true;

  await registerWorker(QUEUES.NOTIFY_DISPATCH, handleDispatch);
  await registerWorker(QUEUES.NOTIFY_MAINTENANCE, runMaintenance);

  // 03:30 daily by default — after the day's traffic, before the morning's.
  const cron = process.env.NOTIFY_MAINTENANCE_CRON || "30 3 * * *";
  await scheduleCron(QUEUES.NOTIFY_MAINTENANCE, cron);

  console.log(`[notify] worker started (maintenance ${cron})`);
};

module.exports = { start, runMaintenance, handleDispatch };
