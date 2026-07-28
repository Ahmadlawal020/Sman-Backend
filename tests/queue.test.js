// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");

const { QUEUES, startQueue, enqueue, registerWorker, stopQueue } = require("../config/queue");

/**
 * Proves the queue actually works against the real database — including on
 * Neon, where pg-boss's polling design (no LISTEN/NOTIFY) is the reason it
 * was chosen. A failure here is a deployment problem, not a code problem,
 * and better discovered by a test than by the first customer message.
 */
describe("pg-boss queue — durable jobs in Postgres", () => {
  after(async () => {
    await stopQueue();
  });

  test("starts, enqueues, and a worker receives the job", async () => {
    await startQueue();

    const received = new Promise((resolve) => {
      registerWorker(QUEUES.WA_INBOUND, async (data) => resolve(data));
    });

    const jobId = await enqueue(QUEUES.WA_INBOUND, { probe: "hello", n: 42 });
    assert.ok(jobId, "send returned a job id");

    const data = await Promise.race([
      received,
      new Promise((_, reject) => setTimeout(() => reject(new Error("worker never received the job")), 20000)),
    ]);
    assert.equal(data.probe, "hello");
    assert.equal(data.n, 42);
  });
});
