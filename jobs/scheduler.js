const { registerWorker, scheduleCron } = require("../config/queue");
const { expireStaleOrders } = require("../services/order.service");

// An ad-hoc pg-boss queue created on demand, mirroring the WhatsApp maintenance
// cron — not part of the WhatsApp queue set.
const EXPIRY_QUEUE = "order-expiry-sweep";

/**
 * Opt-in in-process scheduler. Runs only when SCHEDULED_JOBS_ENABLED=true, so
 * default boot behaviour is unchanged and dev/test/CI never start it. The
 * manual POST /api/order-expiry/run endpoint stays available either way.
 *
 * Only the order-expiry sweep is scheduled here. Settlement is deliberately NOT
 * automated — it moves money and stays a gated, human/infra-triggered action
 * (see server.js and the settlement route).
 */
const start = async () => {
  await registerWorker(EXPIRY_QUEUE, async () => {
    const expired = await expireStaleOrders();
    return { expired };
  });

  // Hourly by default; override with a standard cron expression.
  const cron = process.env.ORDER_EXPIRY_CRON || "0 * * * *";
  await scheduleCron(EXPIRY_QUEUE, cron);
  console.log(`[scheduler] order-expiry sweep scheduled (${cron})`);
};

module.exports = { start, EXPIRY_QUEUE };
