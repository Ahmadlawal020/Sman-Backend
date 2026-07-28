const { PgBoss } = require("pg-boss");

/**
 * The durable job queue — pg-boss, jobs as Postgres rows in the `pgboss`
 * schema. Chosen over Redis/BullMQ deliberately: no second datastore, the
 * existing backups cover the queue, and at fuel-order volume (hundreds of
 * messages a day) a dedicated broker is capacity nobody would use. pg-boss
 * polls — it never needs LISTEN/NOTIFY — so it runs fine through Neon's
 * pooled connection; set PGBOSS_DATABASE_URL to a direct (non-pooled) string
 * if maintenance chatter should bypass the pooler.
 *
 * Why a queue at all: a Meta webhook payload that isn't persisted is
 * unrecoverable (no replay API — retries stop after ~7 days), and Cloud API
 * sends need retry with backoff somewhere a failure is visible. Both are
 * durability problems, and durability lives in the database here.
 */

const QUEUES = Object.freeze({
  // Inbound conversation steps. Processed strictly one at a time (see
  // registerWorker below): a customer's messages must apply to their session
  // in order, and at this volume global serialization is the simplest
  // correct answer.
  WA_INBOUND: "wa-inbound",
  // Outbound Cloud API sends: more retries, spaced out — Meta hiccups and
  // rate limits are transient; a still-failing send lands in the dead-letter
  // queue where it is a queryable row, not a lost message.
  WA_SEND: "wa-send",
});

const DEAD_LETTER = Object.freeze({
  [QUEUES.WA_INBOUND]: "wa-inbound-dead",
  [QUEUES.WA_SEND]: "wa-send-dead",
});

// Per-queue policy, applied at createQueue time.
const QUEUE_OPTIONS = {
  [QUEUES.WA_INBOUND]: {
    retryLimit: 3,
    retryDelay: 5, // seconds; the customer is mid-conversation
    retryBackoff: true,
    expireInSeconds: 60,
    deadLetter: DEAD_LETTER[QUEUES.WA_INBOUND],
  },
  [QUEUES.WA_SEND]: {
    retryLimit: 8,
    retryDelay: 10,
    retryBackoff: true, // 10s, 20s, 40s … transient API trouble self-heals
    expireInSeconds: 60,
    deadLetter: DEAD_LETTER[QUEUES.WA_SEND],
  },
};

let boss = null;
let started = null;

const getBoss = () => {
  if (!boss) {
    const connectionString = process.env.PGBOSS_DATABASE_URL || process.env.DATABASE_URL;
    boss = new PgBoss({
      connectionString,
      schema: "pgboss",
      // Neon-friendly: modest polling, no aggressive maintenance cadence.
      pollingIntervalSeconds: 2,
    });
    boss.on("error", (err) => console.error("[queue] pg-boss error:", err.message));
  }
  return boss;
};

/** Start pg-boss and ensure every queue (and its dead-letter twin) exists. Idempotent. */
const startQueue = async () => {
  if (!started) {
    started = (async () => {
      const b = getBoss();
      await b.start();
      for (const name of Object.values(DEAD_LETTER)) {
        await b.createQueue(name).catch(() => {}); // exists already — fine
      }
      for (const [name, options] of Object.entries(QUEUE_OPTIONS)) {
        await b.createQueue(name, options).catch(() => {});
      }
      return b;
    })();
  }
  return started;
};

/** Enqueue a job. The queue's retry policy applies; data must be jsonb-safe. */
const enqueue = async (queue, data) => {
  const b = await startQueue();
  return b.send(queue, data);
};

/**
 * Register a worker. batchSize 1 — one job at a time per worker — is the
 * ordering guarantee the conversation needs, not an oversight.
 */
const registerWorker = async (queue, handler) => {
  const b = await startQueue();
  return b.work(queue, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      await handler(job.data, job);
    }
  });
};

/** Schedule a cron job (the session sweep, template sync). Idempotent per name. */
const scheduleCron = async (queue, cron, data = {}) => {
  const b = await startQueue();
  await b.createQueue(queue).catch(() => {});
  return b.schedule(queue, cron, data);
};

const stopQueue = async () => {
  if (boss) {
    await boss.stop({ graceful: true, wait: false }).catch(() => {});
    boss = null;
    started = null;
  }
};

module.exports = { QUEUES, DEAD_LETTER, getBoss, startQueue, enqueue, registerWorker, scheduleCron, stopQueue };
