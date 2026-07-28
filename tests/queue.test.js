// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");

const { startQueue, stopQueue } = require("../config/queue");

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
    // A throwaway queue: the shared wa-* queues accumulate real jobs across
    // test runs, and this test must see ITS job, not the backlog.
    const boss = await startQueue();
    const probeQueue = `probe-${Date.now()}`;
    await boss.createQueue(probeQueue);

    const received = new Promise((resolve) => {
      boss.work(probeQueue, { batchSize: 1 }, async (jobs) => resolve(jobs[0].data));
    });

    const jobId = await boss.send(probeQueue, { probe: "hello", n: 42 });
    assert.ok(jobId, "send returned a job id");

    const data = await Promise.race([
      received,
      new Promise((_, reject) => setTimeout(() => reject(new Error("worker never received the job")), 20000)),
    ]);
    assert.equal(data.probe, "hello");
    assert.equal(data.n, 42);
  });
});
