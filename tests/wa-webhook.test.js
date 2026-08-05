// Must precede any require that reaches config/db.
require("dotenv").config();

process.env.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "test-verify-token";
process.env.WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET || "test-app-secret";

const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const request = require("supertest");

const app = require("../app");
const { db } = require("../config/db");
const { waMessages } = require("../db/schema");
const { eq } = require("drizzle-orm");
const { waMessageRepo } = require("../repositories");
const { stopQueue } = require("../config/queue");
const { closeDb } = require("./helpers");

const WEBHOOK = "/api/whatsapp/webhook";
const RUN = Date.now();

const sign = (body) =>
  `sha256=${crypto.createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(body).digest("hex")}`;

// timestamp defaults to "now" (unix seconds) so the stale-inbound guard treats
// it as fresh; pass an old value to exercise the guard.
const inboundPayload = (wamid, from = "2348030000001", text = "hi", timestamp = Math.floor(Date.now() / 1000)) =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "111" },
              messages: [{ id: wamid, from, timestamp: String(timestamp), type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  });

const statusPayload = (wamid, status, errors) =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: { statuses: [{ id: wamid, status, recipient_id: "2348030000001", ...(errors ? { errors } : {}) }] },
          },
        ],
      },
    ],
  });

const post = (body) =>
  request(app).post(WEBHOOK).set("Content-Type", "application/json").set("X-Hub-Signature-256", sign(body)).send(body);

describe("WhatsApp webhook — handshake, HMAC, exactly-once inbox", () => {
  after(async () => {
    await stopQueue();
    await closeDb();
  });

  test("GET handshake echoes the challenge for the right verify token", async () => {
    const res = await request(app).get(WEBHOOK).query({
      "hub.mode": "subscribe",
      "hub.verify_token": process.env.WHATSAPP_VERIFY_TOKEN,
      "hub.challenge": "echo-me-42",
    });
    assert.equal(res.status, 200);
    assert.equal(res.text, "echo-me-42");
  });

  test("GET handshake refuses a wrong verify token", async () => {
    const res = await request(app).get(WEBHOOK).query({
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong",
      "hub.challenge": "echo-me",
    });
    assert.equal(res.status, 403);
  });

  test("a validly signed message is recorded once and acknowledged", async () => {
    const wamid = `wamid.TEST-${RUN}-1`;
    const res = await post(inboundPayload(wamid));
    assert.equal(res.status, 200);

    const rows = await db.select().from(waMessages).where(eq(waMessages.wamid, wamid));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].direction, "inbound");
    assert.equal(rows[0].status, "received");
    assert.equal(rows[0].waPhone, "+2348030000001");
  });

  test("a Meta retry (same wamid) is acknowledged but not recorded twice", async () => {
    const wamid = `wamid.TEST-${RUN}-2`;
    await post(inboundPayload(wamid));
    const retry = await post(inboundPayload(wamid));
    assert.equal(retry.status, 200);

    const rows = await db.select().from(waMessages).where(eq(waMessages.wamid, wamid));
    assert.equal(rows.length, 1, "exactly one row despite the retry");
  });

  test("a message Meta held past the stale window is recorded but skipped, not queued", async () => {
    // Simulate a post-outage redelivery: Meta's timestamp is an hour old.
    const wamid = `wamid.TEST-${RUN}-STALE`;
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const res = await post(inboundPayload(wamid, "2348030000001", "hi", anHourAgo));
    assert.equal(res.status, 200, "still acknowledged so Meta stops retrying");

    const rows = await db.select().from(waMessages).where(eq(waMessages.wamid, wamid));
    assert.equal(rows.length, 1, "recorded for the audit trail");
    assert.equal(rows[0].status, "skipped", "marked skipped, not received");
    assert.match(rows[0].error, /stale/i, "the reason is captured");
  });

  test("a fresh message is recorded 'received' and enqueued (the guard lets it through)", async () => {
    const wamid = `wamid.TEST-${RUN}-FRESH`;
    const res = await post(inboundPayload(wamid)); // default timestamp = now
    assert.equal(res.status, 200);

    const rows = await db.select().from(waMessages).where(eq(waMessages.wamid, wamid));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "received", "fresh message is acted on, not skipped");
  });

  test("a bad signature is rejected and nothing is recorded", async () => {
    const wamid = `wamid.TEST-${RUN}-3`;
    const body = inboundPayload(wamid);
    const res = await request(app)
      .post(WEBHOOK)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", "sha256=deadbeef")
      .send(body);
    assert.ok(res.status >= 400, `expected an error status, got ${res.status}`);

    const rows = await db.select().from(waMessages).where(eq(waMessages.wamid, wamid));
    assert.equal(rows.length, 0);
  });

  test("a missing signature is rejected too", async () => {
    const res = await request(app)
      .post(WEBHOOK)
      .set("Content-Type", "application/json")
      .send(inboundPayload(`wamid.TEST-${RUN}-4`));
    assert.ok(res.status >= 400);
  });

  test("delivery statuses advance the outbound row — and never backwards", async () => {
    const wamid = `wamid.TEST-${RUN}-OUT`;
    const row = await waMessageRepo.createOutbound({
      waPhone: "+2348030000001",
      payload: { kind: "text", body: "hello" },
    });
    await waMessageRepo.markSent(row.id, wamid);

    await post(statusPayload(wamid, "delivered"));
    let [updated] = await db.select().from(waMessages).where(eq(waMessages.id, row.id));
    assert.equal(updated.status, "delivered");

    await post(statusPayload(wamid, "read"));
    [updated] = await db.select().from(waMessages).where(eq(waMessages.id, row.id));
    assert.equal(updated.status, "read");

    // A late 'delivered' after 'read' must not downgrade.
    await post(statusPayload(wamid, "delivered"));
    [updated] = await db.select().from(waMessages).where(eq(waMessages.id, row.id));
    assert.equal(updated.status, "read");
  });

  test("a failed status records Meta's error message on the row", async () => {
    const wamid = `wamid.TEST-${RUN}-FAIL`;
    const row = await waMessageRepo.createOutbound({
      waPhone: "+2348030000001",
      payload: { kind: "text", body: "hello" },
    });
    await waMessageRepo.markSent(row.id, wamid);

    await post(statusPayload(wamid, "failed", [{ code: 131047, message: "Re-engagement message" }]));
    const [updated] = await db.select().from(waMessages).where(eq(waMessages.id, row.id));
    assert.equal(updated.status, "failed");
    assert.match(updated.error, /Re-engagement/);
  });

  test("a status for an unknown wamid is ignored without error", async () => {
    const res = await post(statusPayload(`wamid.NEVER-${RUN}`, "delivered"));
    assert.equal(res.status, 200);
  });
});
