// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const nock = require("nock");

const { sendReply, sendTypingIndicator, toApiPayload, toWaId, GRAPH_VERSION } = require("../whatsapp/client");

const PHONE_ID = "111222333";
const GRAPH = "https://graph.facebook.com";
const PATH = `/${GRAPH_VERSION}/${PHONE_ID}/messages`;
const TO = "+2348030000000";

const env = (over = {}) => {
  process.env.WHATSAPP_ENABLED = "true";
  process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = PHONE_ID;
  Object.assign(process.env, over);
};

describe("whatsapp/client — engine replies onto the Cloud API, faithfully", () => {
  beforeEach(() => {
    nock.cleanAll();
    env();
  });

  after(() => {
    nock.cleanAll();
    delete process.env.WHATSAPP_ENABLED;
  });

  test("recipients are addressed as wa_ids — E.164 digits, no plus", () => {
    assert.equal(toWaId("+2348030000000"), "2348030000000");
    assert.equal(toWaId("2348030000000"), "2348030000000");
  });

  test("text reply → text message", async () => {
    let body;
    nock(GRAPH)
      .post(PATH, (b) => ((body = b), true))
      .reply(200, { messages: [{ id: "wamid.OUT1" }] });

    const res = await sendReply(TO, { kind: "text", body: "Hello 👋" });
    assert.equal(res.wamid, "wamid.OUT1");
    assert.equal(body.type, "text");
    assert.equal(body.to, "2348030000000");
    assert.equal(body.text.body, "Hello 👋");
  });

  test("buttons reply → interactive button message", async () => {
    let body;
    nock(GRAPH)
      .post(PATH, (b) => ((body = b), true))
      .reply(200, { messages: [{ id: "wamid.OUT2" }] });

    await sendReply(TO, {
      kind: "buttons",
      body: "Pick one",
      buttons: [
        { id: "order", title: "Place an order" },
        { id: "track", title: "Track my order" },
      ],
    });
    assert.equal(body.interactive.type, "button");
    assert.deepEqual(body.interactive.action.buttons[0], {
      type: "reply",
      reply: { id: "order", title: "Place an order" },
    });
  });

  test("list reply → interactive list; empty section title omitted", async () => {
    let body;
    nock(GRAPH)
      .post(PATH, (b) => ((body = b), true))
      .reply(200, { messages: [{ id: "wamid.OUT3" }] });

    await sendReply(TO, {
      kind: "list",
      body: "Which depot?",
      button: "Choose a depot",
      sections: [
        {
          title: "",
          rows: [
            { id: "depot:1", title: "Warri", description: "Delta" },
            { id: "depot:2", title: "Lagos" },
          ],
        },
      ],
    });
    assert.equal(body.interactive.type, "list");
    assert.equal(body.interactive.action.button, "Choose a depot");
    const section = body.interactive.action.sections[0];
    assert.equal("title" in section, false, "empty single-section title is omitted");
    assert.deepEqual(section.rows[1], { id: "depot:2", title: "Lagos" });
  });

  test("document reply → document message with link", async () => {
    let body;
    nock(GRAPH)
      .post(PATH, (b) => ((body = b), true))
      .reply(200, { messages: [{ id: "wamid.OUT4" }] });

    await sendReply(TO, {
      kind: "document",
      link: "https://files.example/invoice.pdf",
      filename: "invoice-SOR-1.pdf",
      caption: "Invoice for order SOR-1",
    });
    assert.equal(body.type, "document");
    assert.equal(body.document.link, "https://files.example/invoice.pdf");
  });

  test("template reply → template message with positional body parameters", async () => {
    let body;
    nock(GRAPH)
      .post(PATH, (b) => ((body = b), true))
      .reply(200, { messages: [{ id: "wamid.OUT5" }] });

    await sendReply(TO, { kind: "template", name: "payment_received", variables: { orderNumber: "SOR-9" } });
    assert.equal(body.type, "template");
    assert.equal(body.template.name, "payment_received");
    assert.deepEqual(body.template.components[0].parameters, [{ type: "text", text: "SOR-9" }]);
  });

  test("a variable-free template sends no components at all", () => {
    const payload = toApiPayload(TO, { kind: "template", name: "hello_world", variables: {} });
    assert.equal("components" in payload.template, false);
  });

  test("Meta's rejection reason surfaces in the thrown error", async () => {
    nock(GRAPH)
      .post(PATH)
      .reply(400, { error: { code: 131030, message: "Recipient not in allowed list" } });

    await assert.rejects(
      sendReply(TO, { kind: "text", body: "hi" }),
      /131030.*Recipient not in allowed list/
    );
  });

  test("the kill switch skips without touching the network", async () => {
    env({ WHATSAPP_ENABLED: "false" });
    // No nock interceptor mounted: a network call would throw.
    const res = await sendReply(TO, { kind: "text", body: "hi" });
    assert.equal(res.skipped, true);
  });

  test("missing credentials with the switch ON is an error, not a silent skip", async () => {
    env({ WHATSAPP_ACCESS_TOKEN: "" });
    await assert.rejects(sendReply(TO, { kind: "text", body: "hi" }), /not configured/);
  });

  test("typing indicator marks the inbound read and shows typing", async () => {
    let body;
    nock(GRAPH)
      .post(PATH, (b) => ((body = b), true))
      .reply(200, { success: true });

    const res = await sendTypingIndicator("wamid.INBOUND1");
    assert.equal(res.ok, true);
    assert.equal(body.status, "read");
    assert.equal(body.message_id, "wamid.INBOUND1");
    assert.deepEqual(body.typing_indicator, { type: "text" });
  });

  test("typing indicator failures are absorbed, never thrown", async () => {
    nock(GRAPH).post(PATH).reply(400, { error: { code: 100, message: "nope" } });
    const res = await sendTypingIndicator("wamid.INBOUND2");
    assert.equal(res.ok, false);
    assert.match(res.error, /nope/);
  });

  test("typing indicator respects the kill switch", async () => {
    env({ WHATSAPP_ENABLED: "false" });
    const res = await sendTypingIndicator("wamid.INBOUND3"); // no interceptor: a call would throw
    assert.equal(res.skipped, true);
  });
});
