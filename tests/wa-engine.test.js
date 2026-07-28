/**
 * Table-driven coverage of the conversation engine: every state × every
 * inbound kind, the global commands from everywhere, and each of the §7 edge
 * paths. Pure — no DB, no HTTP, no Meta. Assertions are structural (state,
 * reply kinds, button/row ids, effects); exact wording is pinned separately
 * by the copy snapshot test.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert");

const { reduce, parseLitres, truckSplit, nextStep } = require("../whatsapp/engine");
const { STATES, INBOUND, REPLY, EFFECTS, LIMITS, TEMPLATES } = require("../whatsapp/constants");

// ------------------------------------------------------------------ fixtures

const WARRI = {
  id: 1,
  name: "Warri",
  state: "Delta",
  products: [
    { id: 10, name: "PMS", price: 850, stock: 120000 },
    { id: 11, name: "AGO", price: 1020, stock: 80000 },
  ],
};
const LAGOS = {
  id: 2,
  name: "Lagos",
  state: "Lagos",
  products: [{ id: 10, name: "PMS", price: 870, stock: 50000 }],
};

const LAST_ORDER = {
  id: 99,
  orderNumber: "SOR-99",
  status: "Completed",
  depotId: 1,
  productId: 10,
  quantity: 30000,
  deliveryType: "pickup",
  productName: "PMS",
  depotName: "Warri",
  totalAmount: 25500000,
};

const baseCtx = (over = {}) => ({
  customer: { id: 7, name: "Ada Obi", status: "Active" },
  depots: [WARRI, LAGOS],
  supportPhone: "+2340000000000",
  portalUrl: "https://portal.example",
  withinServiceWindow: true,
  ...over,
});

const manyDepots = () =>
  Array.from({ length: 11 }, (_, i) => ({
    id: i + 1,
    name: `Depot ${i + 1}`,
    state: "Delta",
    products: [{ id: 10, name: "PMS", price: 850, stock: 100000 }],
  }));

const mkSession = (state, cart = {}, extra = {}) => ({
  waPhone: "+2348030000000",
  customerId: 7,
  state,
  cart,
  failureCount: 0,
  ...extra,
});

const txt = (value) => ({ type: INBOUND.TEXT, value });
const btn = (value) => ({ type: INBOUND.BUTTON, value });
const lst = (value) => ({ type: INBOUND.LIST, value });

const kinds = (r) => r.replies.map((x) => x.kind);
const effectTypes = (r) => r.effects.map((e) => e.type);
const rowIds = (reply) => reply.sections.flatMap((s) => s.rows.map((r) => r.id));
const buttonIds = (reply) => reply.buttons.map((b) => b.id);

// A complete pickup cart one tap away from CREATE_ORDER.
const fullPickupCart = () => ({
  depotId: 1,
  productId: 10,
  quantity: 30000,
  deliveryType: "pickup",
  plates: ["ABC-123-XY"],
});

// ---------------------------------------------------------------- pure helpers

describe("pure helpers", () => {
  it("parseLitres accepts the ways people type litres", () => {
    assert.equal(parseLitres("30000"), 30000);
    assert.equal(parseLitres("30,000"), 30000);
    assert.equal(parseLitres("30 000"), 30000);
    assert.equal(parseLitres("30000L"), 30000);
    assert.equal(parseLitres("30000 litres"), 30000);
    assert.equal(parseLitres("30k"), 30000);
    assert.equal(parseLitres("30.5k"), 30500);
    assert.ok(Number.isNaN(parseLitres("plenty")));
    assert.ok(Number.isNaN(parseLitres("")));
  });

  it("truckSplit spreads litres evenly and never loses a litre", () => {
    assert.deepEqual(truckSplit(30000), [30000]);
    assert.deepEqual(truckSplit(60000), [60000]);
    assert.deepEqual(truckSplit(60001), [30001, 30000]);
    assert.deepEqual(truckSplit(150000), [50000, 50000, 50000]);
    const split = truckSplit(130000);
    assert.equal(split.length, 3);
    assert.equal(split.reduce((a, b) => a + b, 0), 130000);
  });

  it("nextStep walks the first unanswered question", () => {
    assert.equal(nextStep({}), STATES.DEPOT);
    assert.equal(nextStep({ depotId: 1 }), STATES.PRODUCT);
    assert.equal(nextStep({ depotId: 1, productId: 10 }), STATES.QUANTITY);
    assert.equal(nextStep({ depotId: 1, productId: 10, quantity: 30000 }), STATES.COLLECT);
    assert.equal(
      nextStep({ depotId: 1, productId: 10, quantity: 30000, deliveryType: "pickup" }),
      STATES.LOGISTICS
    );
    assert.equal(nextStep(fullPickupCart()), STATES.CONFIRM);
    assert.equal(
      nextStep({ depotId: 1, productId: 10, quantity: 150000, deliveryType: "pickup", plates: ["A1"] }),
      STATES.LOGISTICS // 150k litres = 3 trucks; one plate is not enough
    );
  });
});

// ------------------------------------------------------------------- identify

describe("IDENTIFY", () => {
  it("unknown wa_id is asked for a name whatever state it claims", () => {
    const r = reduce(mkSession(STATES.QUANTITY, { depotId: 1 }), txt("30000"), baseCtx({ customer: null }));
    assert.equal(r.session.state, STATES.IDENTIFY);
    assert.deepEqual(kinds(r), [REPLY.TEXT]);
  });

  it("a plausible name emits CREATE_CUSTOMER and waits", () => {
    const r = reduce(mkSession(STATES.IDENTIFY), txt("Ada Obi"), baseCtx({ customer: null }));
    assert.deepEqual(effectTypes(r), [EFFECTS.CREATE_CUSTOMER]);
    assert.equal(r.effects[0].payload.name, "Ada Obi");
    assert.equal(r.session.cart.pendingCustomer, true);
  });

  it("digits are not a name", () => {
    const r = reduce(mkSession(STATES.IDENTIFY), txt("08030000000"), baseCtx({ customer: null }));
    assert.equal(r.session.state, STATES.IDENTIFY);
    assert.equal(r.session.failureCount, 1);
    assert.deepEqual(r.effects, []);
  });

  it("a second message while creation is pending does not re-emit the effect", () => {
    const r = reduce(
      mkSession(STATES.IDENTIFY, { pendingCustomer: true }),
      txt("Ada Obi"),
      baseCtx({ customer: null })
    );
    assert.deepEqual(r.effects, []);
    assert.deepEqual(kinds(r), [REPLY.TEXT]);
  });

  it("CUSTOMER_CREATED lands on a personalised MENU", () => {
    const r = reduce(
      mkSession(STATES.IDENTIFY, { pendingCustomer: true }),
      { type: INBOUND.CUSTOMER_CREATED, customer: { id: 41, name: "Ada Obi" } },
      baseCtx({ customer: null })
    );
    assert.equal(r.session.state, STATES.MENU);
    assert.equal(r.session.customerId, 41);
    assert.ok(kinds(r).includes(REPLY.BUTTONS));
  });
});

// ----------------------------------------------------------------------- menu

describe("MENU", () => {
  it("no order history: three buttons", () => {
    const r = reduce(mkSession(STATES.MENU), txt("hello"), baseCtx());
    assert.deepEqual(kinds(r), [REPLY.BUTTONS]);
    assert.deepEqual(buttonIds(r.replies[0]), ["order", "prices", "track"]);
  });

  it("with order history: a list including Reorder", () => {
    const r = reduce(mkSession(STATES.MENU), txt("menu"), baseCtx({ lastOrder: LAST_ORDER }));
    assert.deepEqual(kinds(r), [REPLY.LIST]);
    assert.deepEqual(rowIds(r.replies[0]), ["order", "reorder", "prices", "track"]);
  });

  it("'order' starts a fresh cart at DEPOT", () => {
    const r = reduce(mkSession(STATES.MENU, { stale: true }), btn("order"), baseCtx());
    assert.equal(r.session.state, STATES.DEPOT);
    assert.equal(r.session.cart.stale, undefined);
    assert.deepEqual(kinds(r), [REPLY.LIST]);
  });

  it("'order' with nothing in stock anywhere says so at MENU", () => {
    const r = reduce(mkSession(STATES.MENU), btn("order"), baseCtx({ depots: [] }));
    assert.equal(r.session.state, STATES.MENU);
    assert.deepEqual(kinds(r), [REPLY.TEXT]);
  });

  it("'prices' answers and stays put", () => {
    const r = reduce(mkSession(STATES.MENU), btn("prices"), baseCtx());
    assert.equal(r.session.state, STATES.MENU);
    assert.deepEqual(kinds(r), [REPLY.TEXT]);
    assert.ok(r.replies[0].body.includes("Warri"));
  });

  it("'reorder' prefills the cart and jumps to what's missing (plates)", () => {
    const r = reduce(mkSession(STATES.MENU), lst("reorder"), baseCtx({ lastOrder: LAST_ORDER }));
    assert.equal(r.session.state, STATES.LOGISTICS);
    assert.equal(r.session.cart.quantity, 30000);
    assert.equal(r.session.cart.deliveryType, "pickup");
  });

  it("'reorder' with insufficient stock falls back to DEPOT with an apology", () => {
    const last = { ...LAST_ORDER, quantity: 999999 };
    const r = reduce(mkSession(STATES.MENU), lst("reorder"), baseCtx({ lastOrder: last }));
    assert.equal(r.session.state, STATES.DEPOT);
    assert.deepEqual(kinds(r), [REPLY.TEXT, REPLY.LIST]);
  });

  it("garbage re-shows the menu and counts a failure", () => {
    const r = reduce(mkSession(STATES.MENU), txt("qwerty"), baseCtx());
    assert.equal(r.session.failureCount, 1);
    assert.deepEqual(kinds(r), [REPLY.BUTTONS]);
  });
});

// ----------------------------------------------------------- global commands

describe("global commands beat state", () => {
  const cart = { depotId: 1, productId: 10 };

  it("'menu' from mid-order returns to MENU", () => {
    const r = reduce(mkSession(STATES.QUANTITY, cart), txt("menu"), baseCtx());
    assert.equal(r.session.state, STATES.MENU);
  });

  it("'hi' from CONFIRM returns to MENU", () => {
    const r = reduce(mkSession(STATES.CONFIRM, fullPickupCart()), txt("HI"), baseCtx());
    assert.equal(r.session.state, STATES.MENU);
  });

  it("'cancel' discards the cart and says so", () => {
    const r = reduce(mkSession(STATES.LOGISTICS, cart), txt("cancel"), baseCtx());
    assert.equal(r.session.state, STATES.MENU);
    assert.deepEqual(r.session.cart, {});
    assert.equal(r.replies.length, 2); // the goodbye + the menu
  });

  it("'help' answers without touching the state", () => {
    const r = reduce(mkSession(STATES.DEPOT, {}), txt("help"), baseCtx());
    assert.equal(r.session.state, STATES.DEPOT);
    assert.deepEqual(kinds(r), [REPLY.TEXT]);
  });

  it("'track' reports the last order from any state, state untouched", () => {
    const r = reduce(mkSession(STATES.QUANTITY, cart), txt("track"), baseCtx({ lastOrder: LAST_ORDER }));
    assert.equal(r.session.state, STATES.QUANTITY);
    assert.ok(r.replies[0].body.includes("SOR-99"));
  });

  it("'track' with no orders says so", () => {
    const r = reduce(mkSession(STATES.MENU), txt("track"), baseCtx());
    assert.deepEqual(kinds(r), [REPLY.TEXT]);
  });

  it("an Inactive customer is refused politely, wherever they are", () => {
    const ctx = baseCtx({ customer: { id: 7, name: "Ada", status: "Inactive" } });
    const r = reduce(mkSession(STATES.QUANTITY, cart), txt("30000"), ctx);
    assert.equal(r.session.state, STATES.QUANTITY); // nothing advances
    assert.deepEqual(kinds(r), [REPLY.TEXT]);
    assert.deepEqual(r.effects, []);
  });

  it("a voice note gets the unsupported-media reply plus the state's question again", () => {
    const r = reduce(mkSession(STATES.COLLECT, cart), { type: INBOUND.UNSUPPORTED }, baseCtx());
    assert.equal(r.session.state, STATES.COLLECT);
    assert.equal(r.session.failureCount, 1);
    assert.equal(r.replies.length, 2);
  });

  it("the third fumble in a state offers the menu instead of repeating", () => {
    const s = mkSession(STATES.DEPOT, {}, { failureCount: 2 });
    const r = reduce(s, txt("???"), baseCtx());
    assert.deepEqual(kinds(r), [REPLY.BUTTONS]);
    assert.deepEqual(buttonIds(r.replies[0]), ["menu", "retry"]);
    assert.equal(r.session.failureCount, 0);
  });

  it("'retry' after three strikes re-asks the state's question cleanly", () => {
    const r = reduce(mkSession(STATES.DEPOT, {}), btn("retry"), baseCtx());
    assert.equal(r.session.state, STATES.DEPOT);
    assert.equal(r.session.failureCount, 0);
    assert.deepEqual(kinds(r), [REPLY.LIST]);
  });
});

// ---------------------------------------------------------------------- depot

describe("DEPOT", () => {
  it("a list selection advances to PRODUCT", () => {
    const r = reduce(mkSession(STATES.DEPOT), lst("depot:1"), baseCtx());
    assert.equal(r.session.state, STATES.PRODUCT);
    assert.equal(r.session.cart.depotId, 1);
  });

  it("typing the depot name works too", () => {
    const r = reduce(mkSession(STATES.DEPOT), txt("warri"), baseCtx());
    assert.equal(r.session.state, STATES.PRODUCT);
  });

  it("an unknown depot is a fumble", () => {
    const r = reduce(mkSession(STATES.DEPOT), lst("depot:404"), baseCtx());
    assert.equal(r.session.state, STATES.DEPOT);
    assert.equal(r.session.failureCount, 1);
  });

  it("eleven depots page: nine rows plus More ▸", () => {
    const r = reduce(mkSession(STATES.MENU), btn("order"), baseCtx({ depots: manyDepots() }));
    const ids = rowIds(r.replies[0]);
    assert.equal(ids.length, 10);
    assert.equal(ids[9], "more");
  });

  it("More ▸ turns the page; the last page wraps around", () => {
    const ctx = baseCtx({ depots: manyDepots() });
    const page2 = reduce(mkSession(STATES.DEPOT, { page: 0 }), lst("more"), ctx);
    assert.ok(rowIds(page2.replies[0]).includes("depot:11"));
    const wrapped = reduce(page2.session, lst("more"), ctx);
    assert.ok(rowIds(wrapped.replies[0]).includes("depot:1"));
  });

  it("changing depot mid-edit clears everything priced off it", () => {
    const cart = fullPickupCart();
    const r = reduce(mkSession(STATES.DEPOT, cart), lst("depot:2"), baseCtx());
    assert.equal(r.session.cart.depotId, 2);
    assert.equal(r.session.cart.productId, undefined);
    assert.equal(r.session.cart.quantity, undefined);
    assert.equal(r.session.cart.deliveryType, "pickup"); // collection survives
  });
});

// -------------------------------------------------------------------- product

describe("PRODUCT", () => {
  it("selection advances to QUANTITY with the stock shown", () => {
    const r = reduce(mkSession(STATES.PRODUCT, { depotId: 1 }), lst("product:10"), baseCtx());
    assert.equal(r.session.state, STATES.QUANTITY);
    assert.ok(r.replies[0].body.includes("120,000"));
  });

  it("typing the product name works too", () => {
    const r = reduce(mkSession(STATES.PRODUCT, { depotId: 1 }), txt("ago"), baseCtx());
    assert.equal(r.session.state, STATES.QUANTITY);
    assert.equal(r.session.cart.productId, 11);
  });

  it("unknown product: apology plus the list again", () => {
    const r = reduce(mkSession(STATES.PRODUCT, { depotId: 1 }), txt("kerosene"), baseCtx());
    assert.equal(r.session.failureCount, 1);
    assert.deepEqual(kinds(r), [REPLY.TEXT, REPLY.LIST]);
  });

  it("depot gone from context: back to DEPOT, with a word", () => {
    const r = reduce(mkSession(STATES.PRODUCT, { depotId: 404 }), txt("pms"), baseCtx());
    assert.equal(r.session.state, STATES.DEPOT);
    assert.deepEqual(kinds(r), [REPLY.TEXT, REPLY.LIST]);
  });
});

// ------------------------------------------------------------------- quantity

describe("QUANTITY", () => {
  const cart = { depotId: 1, productId: 10 };

  it("a clean number advances to COLLECT", () => {
    const r = reduce(mkSession(STATES.QUANTITY, cart), txt("30,000"), baseCtx());
    assert.equal(r.session.state, STATES.COLLECT);
    assert.equal(r.session.cart.quantity, 30000);
  });

  it("nonsense is a fumble", () => {
    const r = reduce(mkSession(STATES.QUANTITY, cart), txt("plenty"), baseCtx());
    assert.equal(r.session.failureCount, 1);
  });

  it("below the minimum is bounced with the minimum named", () => {
    const r = reduce(mkSession(STATES.QUANTITY, cart), txt("500"), baseCtx());
    assert.equal(r.session.state, STATES.QUANTITY);
    assert.ok(r.replies[0].body.includes("1,000"));
  });

  it("an absurd figure is treated as a typo, not an order", () => {
    const r = reduce(mkSession(STATES.QUANTITY, cart), txt("300000000"), baseCtx());
    assert.equal(r.session.state, STATES.QUANTITY);
  });

  it("over stock: offer what's actually there", () => {
    const r = reduce(mkSession(STATES.QUANTITY, cart), txt("150000"), baseCtx());
    assert.equal(r.session.cart.stockOffer, 120000);
    assert.deepEqual(buttonIds(r.replies[0]), ["takeStock", "changeDepot", "menu"]);
  });

  it("taking the offered stock proceeds with it", () => {
    const s = mkSession(STATES.QUANTITY, { ...cart, stockOffer: 120000 });
    const r = reduce(s, btn("takeStock"), baseCtx());
    assert.equal(r.session.state, STATES.COLLECT);
    assert.equal(r.session.cart.quantity, 120000);
    assert.equal(r.session.cart.stockOffer, undefined);
  });

  it("declining via Change depot restarts at DEPOT", () => {
    const s = mkSession(STATES.QUANTITY, { ...cart, stockOffer: 120000 });
    const r = reduce(s, btn("changeDepot"), baseCtx());
    assert.equal(r.session.state, STATES.DEPOT);
  });

  it("typing a fresh (valid) number over the offer also works", () => {
    const s = mkSession(STATES.QUANTITY, { ...cart, stockOffer: 120000 });
    const r = reduce(s, txt("40000"), baseCtx());
    assert.equal(r.session.state, STATES.COLLECT);
    assert.equal(r.session.cart.quantity, 40000);
  });
});

// ------------------------------------------------------- collect & logistics

describe("COLLECT and LOGISTICS", () => {
  const cart = { depotId: 1, productId: 10, quantity: 30000 };

  it("pickup asks for a plate", () => {
    const r = reduce(mkSession(STATES.COLLECT, cart), btn("pickup"), baseCtx());
    assert.equal(r.session.state, STATES.LOGISTICS);
  });

  it("typed 'delivery' asks for an address", () => {
    const r = reduce(mkSession(STATES.COLLECT, cart), txt("Delivery"), baseCtx());
    assert.equal(r.session.state, STATES.LOGISTICS);
  });

  it("a real address reaches CONFIRM", () => {
    const s = mkSession(STATES.LOGISTICS, { ...cart, deliveryType: "delivery" });
    const r = reduce(s, txt("14 Airport Road, Warri, Delta"), baseCtx());
    assert.equal(r.session.state, STATES.CONFIRM);
    assert.deepEqual(kinds(r), [REPLY.BUTTONS]);
  });

  it("a too-short address is bounced", () => {
    const s = mkSession(STATES.LOGISTICS, { ...cart, deliveryType: "delivery" });
    const r = reduce(s, txt("Warri"), baseCtx());
    assert.equal(r.session.state, STATES.LOGISTICS);
  });

  it("one truck: one plate reaches CONFIRM", () => {
    const s = mkSession(STATES.LOGISTICS, { ...cart, deliveryType: "pickup" });
    const r = reduce(s, txt("abc-123-xy"), baseCtx());
    assert.equal(r.session.state, STATES.CONFIRM);
    assert.deepEqual(r.session.cart.plates, ["ABC-123-XY"]); // normalised upper
  });

  it("an implausible plate is bounced", () => {
    const s = mkSession(STATES.LOGISTICS, { ...cart, deliveryType: "pickup" });
    const r = reduce(s, txt("x"), baseCtx());
    assert.equal(r.session.state, STATES.LOGISTICS);
    assert.equal(r.session.failureCount, 1);
  });

  it("150,000 L needs three trucks: plates are collected one at a time", () => {
    const big = { depotId: 1, productId: 10, quantity: 110000, deliveryType: "pickup" };
    const first = reduce(mkSession(STATES.LOGISTICS, big), txt("AAA-111-AA"), baseCtx());
    assert.equal(first.session.state, STATES.LOGISTICS); // truck 2 still owed
    const second = reduce(first.session, txt("BBB-222-BB"), baseCtx());
    assert.equal(second.session.state, STATES.CONFIRM);
    assert.equal(second.session.cart.plates.length, 2);
  });
});

// -------------------------------------------------------------------- confirm

describe("CONFIRM", () => {
  it("the summary shows the server-side total", () => {
    const r = reduce(mkSession(STATES.LOGISTICS, { depotId: 1, productId: 10, quantity: 30000, deliveryType: "pickup" }), txt("ABC-123-XY"), baseCtx());
    assert.ok(r.replies[0].body.includes("25,500,000")); // 30,000 × ₦850
  });

  it("'confirm' emits CREATE_ORDER with the trucks and marks the cart pending", () => {
    const r = reduce(mkSession(STATES.CONFIRM, fullPickupCart()), btn("confirm"), baseCtx());
    assert.deepEqual(effectTypes(r), [EFFECTS.CREATE_ORDER]);
    const payload = r.effects[0].payload;
    assert.equal(payload.state, "Delta"); // from the depot, not the customer
    assert.deepEqual(payload.trucks, [{ truckNumber: "ABC-123-XY", quantity: 30000 }]);
    assert.equal(r.session.cart.pendingOrder, true);
  });

  it("a delivery confirm carries the address instead of trucks", () => {
    const cart = { depotId: 1, productId: 10, quantity: 30000, deliveryType: "delivery", address: "14 Airport Road, Warri" };
    const r = reduce(mkSession(STATES.CONFIRM, cart), btn("confirm"), baseCtx());
    assert.equal(r.effects[0].payload.address, "14 Airport Road, Warri");
    assert.equal(r.effects[0].payload.trucks, undefined);
  });

  it("a second confirm tap while pending does NOT order twice", () => {
    const s = mkSession(STATES.CONFIRM, { ...fullPickupCart(), pendingOrder: true });
    const r = reduce(s, btn("confirm"), baseCtx());
    assert.deepEqual(r.effects, []);
  });

  it("'edit' offers the four things that can change", () => {
    const r = reduce(mkSession(STATES.CONFIRM, fullPickupCart()), btn("edit"), baseCtx());
    assert.deepEqual(rowIds(r.replies[0]), ["edit:depot", "edit:product", "edit:quantity", "edit:collect"]);
  });

  it("editing quantity clears it (and the plates sized off it) and re-asks", () => {
    const r = reduce(mkSession(STATES.CONFIRM, fullPickupCart()), lst("edit:quantity"), baseCtx());
    assert.equal(r.session.state, STATES.QUANTITY);
    assert.equal(r.session.cart.quantity, undefined);
    assert.equal(r.session.cart.plates, undefined);
    assert.equal(r.session.cart.deliveryType, "pickup"); // survives
  });

  it("after an edit, answered steps are skipped on the way back", () => {
    const edited = reduce(mkSession(STATES.CONFIRM, fullPickupCart()), lst("edit:quantity"), baseCtx());
    const r = reduce(edited.session, txt("40000"), baseCtx());
    assert.equal(r.session.state, STATES.LOGISTICS); // straight to plates, not COLLECT
  });

  it("confirming a cart whose stock shrank re-asks quantity, not a dead error", () => {
    const cart = { ...fullPickupCart(), quantity: 999999999 };
    const r = reduce(mkSession(STATES.CONFIRM, { ...cart, quantity: 200000 }), btn("confirm"), baseCtx());
    assert.equal(r.session.state, STATES.QUANTITY);
    assert.deepEqual(r.effects, []);
  });

  it("garbage re-shows the summary", () => {
    const r = reduce(mkSession(STATES.CONFIRM, fullPickupCart()), txt("hmm"), baseCtx());
    assert.equal(r.session.failureCount, 1);
    assert.deepEqual(kinds(r), [REPLY.BUTTONS]);
  });
});

// ------------------------------------------------ order outcomes and payment

describe("order outcomes", () => {
  const ORDER = {
    id: 501,
    orderNumber: "SOR-501",
    totalAmount: 25500000,
    deliveryType: "pickup",
    virtualAccountBank: "Wema Bank",
    virtualAccountNumber: "9930001111",
    virtualAccountName: "SOROMANNIGERI/ AO",
    invoiceUrl: "https://files.example/invoice.pdf",
  };

  it("ORDER_CREATED: invoice document, payment details, portal hint — then AWAIT_PAYMENT", () => {
    const s = mkSession(STATES.CONFIRM, { ...fullPickupCart(), pendingOrder: true });
    const r = reduce(s, { type: INBOUND.ORDER_CREATED, order: ORDER }, baseCtx());
    assert.equal(r.session.state, STATES.AWAIT_PAYMENT);
    assert.equal(r.session.lastOrderId, 501);
    assert.deepEqual(kinds(r), [REPLY.DOCUMENT, REPLY.TEXT, REPLY.TEXT]);
    assert.ok(r.replies[1].body.includes("9930001111"));
  });

  it("no invoice URL: no document reply, everything else intact", () => {
    const { invoiceUrl, ...order } = ORDER;
    const s = mkSession(STATES.CONFIRM, { ...fullPickupCart(), pendingOrder: true });
    const r = reduce(s, { type: INBOUND.ORDER_CREATED, order }, baseCtx());
    assert.ok(!kinds(r).includes(REPLY.DOCUMENT));
  });

  it("ORDER_FAILED on a stock race goes back to QUANTITY with the fresh figure", () => {
    const s = mkSession(STATES.CONFIRM, { ...fullPickupCart(), pendingOrder: true });
    const r = reduce(s, { type: INBOUND.ORDER_FAILED, reason: "stock", stock: 45000 }, baseCtx());
    assert.equal(r.session.state, STATES.QUANTITY);
    assert.ok(r.replies[0].body.includes("45,000"));
    assert.equal(r.session.cart.pendingOrder, undefined);
  });

  it("ORDER_FAILED with zero stock left goes back to DEPOT", () => {
    const s = mkSession(STATES.CONFIRM, { ...fullPickupCart(), pendingOrder: true });
    const r = reduce(s, { type: INBOUND.ORDER_FAILED, reason: "stock", stock: 0 }, baseCtx());
    assert.equal(r.session.state, STATES.DEPOT);
  });

  it("a generic ORDER_FAILED apologises and lets confirm retry", () => {
    const s = mkSession(STATES.CONFIRM, { ...fullPickupCart(), pendingOrder: true });
    const failed = reduce(s, { type: INBOUND.ORDER_FAILED, reason: "unknown" }, baseCtx());
    assert.equal(failed.session.state, STATES.CONFIRM);
    const retried = reduce(failed.session, btn("confirm"), baseCtx());
    assert.deepEqual(effectTypes(retried), [EFFECTS.CREATE_ORDER]);
  });

  it("AWAIT_PAYMENT nudges with the account details on random text", () => {
    const s = mkSession(STATES.AWAIT_PAYMENT, {
      awaiting: { orderNumber: "SOR-501", totalAmount: 25500000, virtualAccountBank: "Wema Bank", virtualAccountNumber: "9930001111" },
    });
    const r = reduce(s, txt("have you seen it?"), baseCtx());
    assert.equal(r.session.state, STATES.AWAIT_PAYMENT);
    assert.ok(r.replies[0].body.includes("9930001111"));
  });

  it("PAYMENT_CONFIRMED inside the window: a warm text, back to MENU", () => {
    const s = mkSession(STATES.AWAIT_PAYMENT, { awaiting: {} });
    const r = reduce(s, { type: INBOUND.PAYMENT_CONFIRMED, order: { orderNumber: "SOR-501" } }, baseCtx());
    assert.equal(r.session.state, STATES.MENU);
    assert.deepEqual(kinds(r), [REPLY.TEXT]);
  });

  it("PAYMENT_CONFIRMED outside the window: the approved template, nothing else", () => {
    const s = mkSession(STATES.AWAIT_PAYMENT, { awaiting: {} });
    const ctx = baseCtx({ withinServiceWindow: false });
    const r = reduce(s, { type: INBOUND.PAYMENT_CONFIRMED, order: { orderNumber: "SOR-501" } }, ctx);
    assert.deepEqual(kinds(r), [REPLY.TEMPLATE]);
    assert.equal(r.replies[0].name, TEMPLATES.PAYMENT_RECEIVED);
  });
});

// ------------------------------------------------------------ expiry & resume

describe("expired sessions", () => {
  const cart = { depotId: 1, productId: 10, quantity: 30000 };

  it("an expired cart is offered back, not silently dropped", () => {
    const s = mkSession(STATES.COLLECT, cart, { expired: true });
    const r = reduce(s, txt("pickup"), baseCtx());
    assert.deepEqual(buttonIds(r.replies[0]), ["resume", "startover"]);
    assert.equal(r.session.cart.resumeState, STATES.COLLECT);
  });

  it("'resume' picks up at the first unanswered step", () => {
    const s = mkSession(STATES.MENU, { ...cart, resumeState: STATES.COLLECT });
    const r = reduce(s, btn("resume"), baseCtx());
    assert.equal(r.session.state, STATES.COLLECT);
    assert.equal(r.session.cart.resumeState, undefined);
  });

  it("'resume' revalidates: stock that shrank re-asks quantity", () => {
    const s = mkSession(STATES.MENU, { ...cart, quantity: 130000, resumeState: STATES.COLLECT });
    const r = reduce(s, btn("resume"), baseCtx());
    assert.equal(r.session.state, STATES.QUANTITY);
  });

  it("'startover' clears the cart back to MENU", () => {
    const s = mkSession(STATES.MENU, { ...cart, resumeState: STATES.COLLECT });
    const r = reduce(s, btn("startover"), baseCtx());
    assert.equal(r.session.state, STATES.MENU);
    assert.deepEqual(r.session.cart, {});
  });

  it("an expired empty cart just gets the menu — nothing to resume", () => {
    const s = mkSession(STATES.MENU, {}, { expired: true });
    const r = reduce(s, txt("hi"), baseCtx());
    assert.equal(r.session.state, STATES.MENU);
    assert.deepEqual(kinds(r), [REPLY.BUTTONS]);
  });
});

// -------------------------------------------------------------- window & limits

describe("service window and hard limits", () => {
  it("outside the window every reply is a template — whatever was asked", () => {
    const r = reduce(mkSession(STATES.MENU), txt("menu"), baseCtx({ withinServiceWindow: false }));
    assert.ok(r.replies.every((x) => x.kind === REPLY.TEMPLATE));
  });

  it("depot names longer than a row title are clamped, not rejected", () => {
    const depots = [
      {
        id: 1,
        name: "An Extremely Long Depot Name Beyond Any Row Title Limit",
        state: "Delta",
        products: [{ id: 10, name: "PMS", price: 850, stock: 1000000 }],
      },
    ];
    const r = reduce(mkSession(STATES.MENU), btn("order"), baseCtx({ depots }));
    const title = r.replies[0].sections[0].rows[0].title;
    assert.ok(title.length <= LIMITS.MAX_ROW_TITLE);
  });

  it("a prices body with many depots stays under the body limit", () => {
    const depots = Array.from({ length: 40 }, (_, i) => ({
      id: i,
      name: `Depot With A Fairly Long Name ${i}`,
      state: "Delta",
      products: [
        { id: 1, name: "PMS", price: 850, stock: 1 },
        { id: 2, name: "AGO", price: 1020, stock: 1 },
      ],
    }));
    const r = reduce(mkSession(STATES.MENU), btn("prices"), baseCtx({ depots }));
    assert.ok(r.replies[0].body.length <= LIMITS.MAX_BODY);
  });
});
