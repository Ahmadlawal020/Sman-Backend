/**
 * Property tests — where the real bugs are. Rather than picking cases, these
 * generate thousands of sessions × inbounds × contexts and assert the
 * invariants the plan demands:
 *
 *   1. Totality — no input, in any state, throws; the result is well-formed.
 *   2. WhatsApp limits — every reply the engine can produce fits them.
 *      (The failure this prevents surfaces in a send worker, at 2am,
 *      the day the eleventh depot is added.)
 *   3. Service window — outside it, only `template` replies leave.
 *   4. Escape hatch — "menu" from anywhere, with any cart, lands on MENU.
 *   5. Serializability — the session survives the jsonb round-trip intact.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");

const { reduce } = require("../whatsapp/engine");
const { STATES, INBOUND, REPLY, LIMITS } = require("../whatsapp/constants");

// ------------------------------------------------------------- arbitraries

const arbProduct = fc.record({
  id: fc.integer({ min: 1, max: 50 }),
  name: fc.string({ minLength: 0, maxLength: 40 }),
  price: fc.oneof(fc.integer({ min: 0, max: 5000 }), fc.constant(null)),
  stock: fc.oneof(fc.integer({ min: 0, max: 2_000_000 }), fc.constant(null)),
});

const arbDepot = fc.record({
  id: fc.integer({ min: 1, max: 50 }),
  name: fc.string({ minLength: 0, maxLength: 60 }),
  state: fc.string({ minLength: 0, maxLength: 20 }),
  products: fc.array(arbProduct, { maxLength: 15 }),
});

const arbCustomer = fc.oneof(
  fc.constant(null),
  fc.record({
    id: fc.integer({ min: 1, max: 1000 }),
    name: fc.string({ maxLength: 60 }),
    status: fc.constantFrom("Active", "Inactive", "Pending", undefined),
  })
);

const arbLastOrder = fc.oneof(
  fc.constant(undefined),
  fc.record({
    id: fc.integer({ min: 1, max: 1000 }),
    orderNumber: fc.string({ maxLength: 20 }),
    status: fc.constantFrom("Pending", "Paid", "Released", "Loading", "Completed", "Cancelled", "??"),
    depotId: fc.integer({ min: 1, max: 60 }),
    productId: fc.integer({ min: 1, max: 60 }),
    quantity: fc.integer({ min: 0, max: 2_000_000 }),
    deliveryType: fc.constantFrom("pickup", "delivery"),
    productName: fc.string({ maxLength: 40 }),
    depotName: fc.string({ maxLength: 40 }),
    totalAmount: fc.integer({ min: 0 }),
  })
);

const arbContext = fc.record({
  customer: arbCustomer,
  depots: fc.array(arbDepot, { maxLength: 15 }),
  lastOrder: arbLastOrder,
  supportPhone: fc.constant("+2340000000000"),
  portalUrl: fc.oneof(fc.constant(undefined), fc.constant("https://portal.example")),
  withinServiceWindow: fc.boolean(),
});

const arbCart = fc.record(
  {
    depotId: fc.integer({ min: 1, max: 60 }),
    productId: fc.integer({ min: 1, max: 60 }),
    quantity: fc.integer({ min: -5, max: 2_000_000 }),
    deliveryType: fc.constantFrom("pickup", "delivery", "??"),
    plates: fc.array(fc.string({ maxLength: 16 }), { maxLength: 5 }),
    address: fc.string({ maxLength: 80 }),
    page: fc.integer({ min: -3, max: 30 }),
    stockOffer: fc.integer({ min: 0, max: 2_000_000 }),
    pendingOrder: fc.boolean(),
    pendingCustomer: fc.boolean(),
    resumeState: fc.constantFrom(...Object.values(STATES)),
    awaiting: fc.record({
      orderNumber: fc.string({ maxLength: 20 }),
      totalAmount: fc.integer({ min: 0 }),
      virtualAccountBank: fc.string({ maxLength: 30 }),
      virtualAccountNumber: fc.string({ maxLength: 12 }),
    }),
  },
  { requiredKeys: [] }
);

const arbSession = fc.record({
  waPhone: fc.constant("+2348030000000"),
  customerId: fc.oneof(fc.constant(undefined), fc.integer({ min: 1, max: 1000 })),
  state: fc.oneof(fc.constantFrom(...Object.values(STATES)), fc.constant("NOT_A_STATE")),
  cart: arbCart,
  lastOrderId: fc.oneof(fc.constant(undefined), fc.integer({ min: 1 })),
  failureCount: fc.integer({ min: -1, max: 10 }),
  expired: fc.boolean(),
});

const arbUserValue = fc.oneof(
  fc.string({ maxLength: 40 }), // arbitrary human input, emoji and all
  fc.constantFrom(
    "menu", "hi", "cancel", "help", "track", "retry", "order", "prices", "reorder",
    "confirm", "confirm:deadbeef", "confirm:", "edit", "pickup", "delivery", "more", "resume", "startover",
    "takeStock", "changeDepot", "30000", "30,000", "0", "-5", "999999999",
    "edit:depot", "edit:quantity", "depot:1", "depot:404", "product:10", "ABC-123-XY"
  )
);

const arbInbound = fc.oneof(
  fc.record({ type: fc.constantFrom(INBOUND.TEXT, INBOUND.BUTTON, INBOUND.LIST), value: arbUserValue }),
  fc.constant({ type: INBOUND.UNSUPPORTED }),
  fc.record({
    type: fc.constant(INBOUND.ORDER_CREATED),
    order: fc.record(
      {
        id: fc.integer({ min: 1 }),
        orderNumber: fc.string({ maxLength: 20 }),
        totalAmount: fc.integer({ min: 0 }),
        deliveryType: fc.constantFrom("pickup", "delivery"),
        virtualAccountBank: fc.string({ maxLength: 30 }),
        virtualAccountNumber: fc.string({ maxLength: 12 }),
        virtualAccountName: fc.string({ maxLength: 40 }),
        invoiceUrl: fc.constant("https://files.example/i.pdf"),
      },
      { requiredKeys: [] }
    ),
  }),
  fc.record({
    type: fc.constant(INBOUND.ORDER_FAILED),
    reason: fc.constantFrom("stock", "unknown", undefined),
    stock: fc.integer({ min: 0, max: 100000 }),
  }),
  fc.record({
    type: fc.constant(INBOUND.CUSTOMER_CREATED),
    customer: fc.record({ id: fc.integer({ min: 1 }), name: fc.string({ maxLength: 60 }) }, { requiredKeys: [] }),
  }),
  fc.record({
    type: fc.constant(INBOUND.PAYMENT_CONFIRMED),
    order: fc.record({ orderNumber: fc.string({ maxLength: 20 }) }, { requiredKeys: [] }),
  }),
  // Hostile shapes the normaliser should never emit — but totality means never.
  fc.constant(null),
  fc.constant({}),
  fc.record({ type: fc.string({ maxLength: 10 }), value: fc.anything() })
);

// ------------------------------------------------------------- reply checker

const assertReplyWithinLimits = (reply) => {
  assert.ok(reply && typeof reply.kind === "string", "reply has a kind");
  if (reply.body !== undefined) {
    assert.ok(reply.body.length <= LIMITS.MAX_BODY, `body ${reply.body.length} > ${LIMITS.MAX_BODY}`);
  }
  if (reply.kind === REPLY.BUTTONS) {
    assert.ok(reply.buttons.length >= 1 && reply.buttons.length <= LIMITS.MAX_BUTTONS);
    for (const b of reply.buttons) {
      assert.ok(b.id, "button id");
      assert.ok(b.title.length >= 1 && b.title.length <= LIMITS.MAX_BUTTON_TITLE, `button title "${b.title}"`);
    }
  }
  if (reply.kind === REPLY.LIST) {
    const rows = reply.sections.flatMap((s) => s.rows);
    assert.ok(rows.length >= 1 && rows.length <= LIMITS.MAX_LIST_ROWS, `rows ${rows.length}`);
    assert.ok(reply.button.length >= 1 && reply.button.length <= LIMITS.MAX_LIST_BUTTON);
    for (const s of reply.sections) {
      assert.ok(String(s.title ?? "").length <= LIMITS.MAX_SECTION_TITLE);
    }
    for (const r of rows) {
      assert.ok(r.id !== undefined && r.id !== null, "row id");
      assert.ok(String(r.title).length >= 1 && String(r.title).length <= LIMITS.MAX_ROW_TITLE, `row title "${r.title}"`);
      if (r.description !== undefined) {
        assert.ok(r.description.length <= LIMITS.MAX_ROW_DESCRIPTION, `row description "${r.description}"`);
      }
    }
  }
  if (reply.kind === REPLY.TEMPLATE) {
    assert.ok(typeof reply.name === "string" && reply.name.length > 0, "template name");
  }
};

const NUM_RUNS = { numRuns: 500 };

// ------------------------------------------------------------------ properties

describe("engine properties", () => {
  it("totality: no session × inbound × context throws, and the shape is always right", () => {
    fc.assert(
      fc.property(arbSession, arbInbound, arbContext, (session, inbound, context) => {
        const r = reduce(session, inbound, context);
        assert.ok(r && typeof r === "object");
        assert.ok(Object.values(STATES).includes(r.session.state), `state ${r.session.state}`);
        assert.ok(Array.isArray(r.replies));
        assert.ok(Array.isArray(r.effects));
        for (const e of r.effects) assert.ok(typeof e.type === "string" && e.payload);
      }),
      NUM_RUNS
    );
  });

  it("every reply the engine can produce respects WhatsApp's limits", () => {
    fc.assert(
      fc.property(arbSession, arbInbound, arbContext, (session, inbound, context) => {
        const r = reduce(session, inbound, context);
        for (const reply of r.replies) assertReplyWithinLimits(reply);
      }),
      NUM_RUNS
    );
  });

  it("outside the service window, only templates leave", () => {
    fc.assert(
      fc.property(arbSession, arbInbound, arbContext, (session, inbound, context) => {
        const r = reduce(session, inbound, { ...context, withinServiceWindow: false });
        for (const reply of r.replies) {
          assert.equal(reply.kind, REPLY.TEMPLATE, `leaked a ${reply.kind} outside the window`);
        }
      }),
      NUM_RUNS
    );
  });

  it("'menu' from any state, with any cart, lands on MENU", () => {
    fc.assert(
      fc.property(arbSession, arbContext, (session, context) => {
        // A customer must exist (else IDENTIFY wins) and be Active (else refused).
        const ctx = { ...context, customer: { id: 1, name: "Ada", status: "Active" } };
        const r = reduce({ ...session, expired: false, cart: { ...session.cart, resumeState: undefined } }, { type: INBOUND.TEXT, value: "menu" }, ctx);
        assert.equal(r.session.state, STATES.MENU);
      }),
      NUM_RUNS
    );
  });

  it("the session always survives the jsonb round-trip", () => {
    fc.assert(
      fc.property(arbSession, arbInbound, arbContext, (session, inbound, context) => {
        const r = reduce(session, inbound, context);
        assert.deepEqual(JSON.parse(JSON.stringify(r.session)), r.session);
      }),
      NUM_RUNS
    );
  });
});
