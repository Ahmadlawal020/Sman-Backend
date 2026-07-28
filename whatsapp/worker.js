const { QUEUES, enqueue, registerWorker, scheduleCron } = require("../config/queue");
const { processInbound, processSend, processEvent } = require("./pipeline");
const { waSessionRepo } = require("../repositories");
const { db } = require("../config/db");
const { waMessages } = require("../db/schema");
const { and, eq, lt } = require("drizzle-orm");

/**
 * Boot wiring for the WhatsApp workers. Called from server.js when
 * WHATSAPP_ENABLED=true; a failure here must never take the dashboard down —
 * the caller logs and continues, and the durable inbox (wa_messages) holds
 * everything until workers are healthy again.
 */

const REQUIRED_WHEN_ENABLED = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
];

const MAINTENANCE_QUEUE = "wa-maintenance";
const STUCK_AFTER_MINUTES = 2;

/**
 * The janitor half of the durability story: the webhook records the inbound
 * row and THEN enqueues, non-atomically. A crash in between leaves a row
 * status='received' with no job — Meta's retry would hit the dedupe wall and
 * never reprocess it. So the cron re-enqueues any received row older than a
 * couple of minutes; processInbound is idempotent, so a duplicate job is
 * harmless and a lost one is healed.
 */
const requeueStuckInbound = async () => {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60 * 1000);
  const stuck = await db
    .select({ id: waMessages.id })
    .from(waMessages)
    .where(
      and(
        eq(waMessages.direction, "inbound"),
        eq(waMessages.status, "received"),
        lt(waMessages.createdAt, cutoff)
      )
    )
    .limit(50);
  for (const row of stuck) {
    await enqueue(QUEUES.WA_INBOUND, { waMessageId: row.id });
  }
  return stuck.length;
};

const runMaintenance = async () => {
  const swept = await waSessionRepo.sweepExpired();
  const requeued = await requeueStuckInbound();
  if (swept || requeued) {
    console.log(`[wa-maintenance] sessions swept: ${swept}, inbound re-queued: ${requeued}`);
  }
};

const startWhatsApp = async () => {
  const missing = REQUIRED_WHEN_ENABLED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`WHATSAPP_ENABLED=true but missing env: ${missing.join(", ")}`);
  }

  await registerWorker(QUEUES.WA_INBOUND, processInbound);
  await registerWorker(QUEUES.WA_SEND, processSend);
  await registerWorker(QUEUES.WA_EVENTS, processEvent);
  await scheduleCron(MAINTENANCE_QUEUE, "*/10 * * * *");
  await registerWorker(MAINTENANCE_QUEUE, runMaintenance);

  console.log("[whatsapp] workers up: inbound, send, maintenance (every 10 min)");
};

module.exports = { startWhatsApp, runMaintenance, requeueStuckInbound, REQUIRED_WHEN_ENABLED };
