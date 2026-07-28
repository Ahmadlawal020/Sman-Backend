// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { db } = require("../config/db");
const { depots, products, depotProductPrices, pfis, waSessions } = require("../db/schema");
const { eq } = require("drizzle-orm");
const { customerRepo, orderRepo, waMessageRepo, waSessionRepo } = require("../repositories");
const { normalizeInbound } = require("../whatsapp/normalize");
const { processInbound, processSend, processEvent } = require("../whatsapp/pipeline");
const { runMaintenance } = require("../whatsapp/worker");
const { stopQueue } = require("../config/queue");
const { closeDb } = require("./helpers");

const RUN = Date.now();
const PHONE = `+234817${String(RUN).slice(-6)}0`;
const UNIT_PRICE = 100;

let wamidSeq = 0;
const nextWamid = () => `wamid.PIPE-${RUN}-${(wamidSeq += 1)}`;

/** Record a customer text and run the pipeline turn; return NEW outbound rows. */
const say = async (text) => {
  const wamid = nextWamid();
  const row = await waMessageRepo.recordInbound({
    wamid,
    waPhone: PHONE,
    payload: { id: wamid, from: PHONE.slice(1), type: "text", text: { body: text } },
  });
  const session = await waSessionRepo.findByPhone(PHONE);
  const beforeIds = session ? (await waMessageRepo.findBySession(session.id)).map((m) => m.id) : [];
  await processInbound({ waMessageId: row.id });
  const savedSession = await waSessionRepo.findByPhone(PHONE);
  const all = await waMessageRepo.findBySession(savedSession.id);
  const fresh = all.filter((m) => m.direction === "outbound" && !beforeIds.includes(m.id));
  return { wamid, session: savedSession, outbound: fresh };
};

describe("wa pipeline — a whole order placed over WhatsApp, no Meta required", () => {
  before(async () => {
    // The kill switch stays OFF: sends are recorded and skipped, never wired.
    process.env.WHATSAPP_ENABLED = "false";

    const [depot] = await db
      .insert(depots)
      .values({
        name: `Pipe Depot ${String(RUN).slice(-4)}`,
        code: `PIP${String(RUN).slice(-5)}`,
        address: "1 Rd",
        city: "Warri",
        state: "Delta",
        country: "NG",
        postcode: "332211",
        maxCapacity: 10000000,
        establishedYear: "2020",
      })
      .returning();

    const [product] = await db
      .insert(products)
      .values({ name: `Pipe PMS ${String(RUN).slice(-4)}`, sku: `PIP-${String(RUN).slice(-5)}`, category: "PMS" })
      .returning();

    await db.insert(depotProductPrices).values({ depotId: depot.id, productId: product.id, currentPrice: String(UNIT_PRICE) });
    await db.insert(pfis).values({
      pfiNumber: `PFI-PIP-${RUN}`,
      status: "active",
      locationId: depot.id,
      productId: product.id,
      startingQtyLitres: 1000000,
      soldQtyLitres: 0,
    });

    this.depot = depot;
    this.product = product;
  });

  after(async () => {
    await stopQueue();
    await closeDb();
  });

  test("normalize: Meta's three interactive shapes and the unreadable rest", () => {
    assert.deepEqual(
      normalizeInbound({ type: "text", text: { body: "30000" } }).type + "",
      "text"
    );
    const btn = normalizeInbound({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "confirm", title: "Confirm ✅" } } });
    assert.equal(btn.type, "button");
    assert.equal(btn.value, "confirm");
    const list = normalizeInbound({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "depot:7", title: "Warri" } } });
    assert.equal(list.type, "list");
    assert.equal(list.value, "depot:7");
    assert.equal(normalizeInbound({ type: "audio", audio: {} }).type, "unsupported");
    assert.equal(normalizeInbound(undefined).type, "unsupported");
  });

  test("an unknown number is asked for a name; nothing else", async () => {
    const { session, outbound } = await say("hi");
    assert.equal(session.state, "IDENTIFY");
    assert.equal(session.customerId, null);
    assert.equal(outbound.length, 1);
    assert.match(outbound[0].payload.body, /name/i);
    assert.equal(outbound[0].status, "queued", "recorded before any send attempt");
  });

  test("the send worker with the kill switch off marks the row skipped, touching nothing", async () => {
    const session = await waSessionRepo.findByPhone(PHONE);
    const queued = (await waMessageRepo.findBySession(session.id)).find(
      (m) => m.direction === "outbound" && m.status === "queued"
    );
    assert.ok(queued, "a queued outbound row exists");
    await processSend({ waMessageId: queued.id });
    const after = await waMessageRepo.findById(queued.id);
    assert.equal(after.status, "skipped");
    assert.match(after.error, /WHATSAPP_ENABLED/);
  });

  test("a name creates the customer — Active, phone-verified, created_via whatsapp, no OTP", async () => {
    const { session, outbound } = await say("Chinedu Okeke");
    const customer = await customerRepo.findByPhone(PHONE);
    assert.ok(customer, "customer exists");
    assert.equal(customer.name, "Chinedu Okeke");
    assert.equal(customer.status, "Active");
    assert.equal(customer.createdVia, "whatsapp");
    assert.ok(customer.phoneVerifiedAt, "phone verified by the channel itself");
    assert.equal(session.customerId, customer.id);
    assert.equal(session.state, "MENU");
    assert.ok(outbound.length >= 1, "welcome + menu went out");
  });

  test("order → depot → product → quantity → collect → plate lands on CONFIRM", async () => {
    await say("order");
    await say(this.depot.name.toLowerCase()); // typed depot name matches
    await say(this.product.name);
    await say("5,000");
    await say("pickup");
    const { session, outbound } = await say("abc-123-xy");
    assert.equal(session.state, "CONFIRM");
    assert.deepEqual(session.cart.trucks, [{ quantity: 5000, plate: "ABC-123-XY" }]);
    const summary = outbound[outbound.length - 1].payload;
    assert.equal(summary.kind, "buttons");
    assert.match(summary.body, /500,000/); // 5,000 L × ₦100 — the server-side total
  });

  test("confirm places a REAL order through placeOrder, idempotency key = wamid", async () => {
    // The engine-created customer has no DVA; give them one so the test never
    // reaches for Paystack (live flow would create it lazily inside placeOrder).
    const customer = await customerRepo.findByPhone(PHONE);
    await customerRepo.update(customer.id, {
      virtualAccountNumber: `VPIPE${String(RUN).slice(-5)}`,
      virtualAccountBank: "Test Bank",
      virtualAccountName: "SOROMANNIGERI/ CO",
    });

    const { wamid, session, outbound } = await say("confirm");
    assert.equal(session.state, "AWAIT_PAYMENT");
    assert.ok(session.lastOrderId, "session points at the real order");

    const order = await orderRepo.findById(session.lastOrderId);
    assert.equal(order.idempotencyKey, wamid, "the confirm message's wamid is the dedupe key");
    assert.equal(order.quantity, 5000);
    assert.equal(order.deliveryType, "pickup");
    assert.equal(order.status, "Pending"); // zero wallet balance — awaits transfer

    const paymentMsg = outbound.find((m) => m.payload.kind === "text" && /VPIPE/.test(m.payload.body));
    assert.ok(paymentMsg, "the reply carries the dedicated account number");
  });

  test("re-running the processed confirm turn does nothing — and a NEW confirm cannot double-order", async () => {
    const ordersBefore = (await db.select().from(waSessions).where(eq(waSessions.waPhone, PHONE)))[0].lastOrderId;

    // Replay the exact job (pg-boss retry): status=processed short-circuits.
    const session = await waSessionRepo.findByPhone(PHONE);
    const transcript = await waMessageRepo.findBySession(session.id);
    const confirmRow = transcript.filter((m) => m.direction === "inbound").pop();
    const countBefore = transcript.length;
    await processInbound({ waMessageId: confirmRow.id });
    const after = await waMessageRepo.findBySession(session.id);
    assert.equal(after.length, countBefore, "no new outbound from a replayed job");

    // A fresh "confirm" text in AWAIT_PAYMENT is just a nudge, not an order.
    await say("confirm");
    const s = await waSessionRepo.findByPhone(PHONE);
    assert.equal(s.lastOrderId, ordersBefore);
  });

  test("track answers from the session's last order", async () => {
    const { outbound } = await say("track");
    const reply = outbound[outbound.length - 1].payload;
    assert.match(reply.body, /Pending|waiting/i);
  });

  test("a settlement-confirmed payment pushes 'payment received' into the conversation", async () => {
    // Put the session back where a paying customer would be.
    const stored = await waSessionRepo.findByPhone(PHONE);
    const orderId = stored.lastOrderId;
    await waSessionRepo.save(PHONE, {
      customerId: stored.customerId,
      state: "AWAIT_PAYMENT",
      cart: { awaiting: { orderNumber: "x", totalAmount: 1, virtualAccountBank: "b", virtualAccountNumber: "n" } },
      lastOrderId: orderId,
      failureCount: 0,
    });
    const before = (await waMessageRepo.findBySession(stored.id)).length;

    await processEvent({ type: "payment_confirmed", orderId });

    const session = await waSessionRepo.findByPhone(PHONE);
    assert.equal(session.state, "MENU", "nothing left to await");
    const all = await waMessageRepo.findBySession(session.id);
    assert.ok(all.length > before, "a push went out");
    const push = all[all.length - 1];
    assert.equal(push.direction, "outbound");
    assert.match(push.payload.body, /Payment received/i);
  });

  test("a payment event for a customer with no WhatsApp session is skipped quietly", async () => {
    const stored = await waSessionRepo.findByPhone(PHONE);
    const orderId = stored.lastOrderId;
    await waSessionRepo.deleteByPhone(PHONE);
    await processEvent({ type: "payment_confirmed", orderId }); // must not throw
    assert.equal(await waSessionRepo.findByPhone(PHONE), null, "still no session — none was invented");
    // Put the conversation back for the tests that follow.
    await waSessionRepo.save(PHONE, {
      customerId: stored.customerId,
      state: stored.state,
      cart: stored.cart,
      lastOrderId: stored.lastOrderId,
      failureCount: 0,
    });
  });

  test("the maintenance sweep deletes sessions past their resume grace, keeps the rest", async () => {
    const oldPhone = `+234818${String(RUN).slice(-6)}1`;
    await waSessionRepo.save(oldPhone, { state: "MENU", cart: {}, failureCount: 0 });
    // Push it far past expiry + grace.
    await db
      .update(waSessions)
      .set({ expiresAt: new Date(Date.now() - 26 * 60 * 60 * 1000) })
      .where(eq(waSessions.waPhone, oldPhone));

    await runMaintenance();

    assert.equal(await waSessionRepo.findByPhone(oldPhone), null, "stale session swept");
    assert.ok(await waSessionRepo.findByPhone(PHONE), "the live conversation survives");
  });
});
