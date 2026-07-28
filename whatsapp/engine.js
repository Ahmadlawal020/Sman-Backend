/**
 * The conversation engine — a pure function.
 *
 *   reduce(session, inbound, context) → { session, replies, effects }
 *
 * No database, no HTTP, no Date.now(), no randomness. The caller loads
 * `context` (customer, orderable depots/products, service window), performs
 * any `effects` this returns (CREATE_ORDER, CREATE_CUSTOMER), and re-enters
 * with the outcome as a new inbound — so order creation is two turns of the
 * same loop and failure is an ordinary path with its own copy.
 *
 * Design rules enforced here, not in the client:
 *  - WhatsApp's limits (3 buttons, 10 rows, title lengths, 1024-char body)
 *    are respected by construction; reply constructors clamp.
 *  - Outside the 24-hour service window only `template` replies leave.
 *  - Global commands beat state; no state can swallow "menu".
 *  - No input, in any state, throws.
 */

const {
  STATES,
  LIMITS,
  PAGE_SIZE,
  COMMANDS,
  INBOUND,
  REPLY,
  EFFECTS,
  TEMPLATES,
  MIN_ORDER_LITRES,
  MAX_ORDER_LITRES,
  TRUCK_CAPACITY_LITRES,
  MAX_FAILURES,
} = require("./constants");
const copy = require("./copy");

// ---------------------------------------------------------------- reply kit

const clamp = (str, max) => {
  const s = String(str ?? "");
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
};

// Titles must be 1..max chars; blank data must not become an invalid message.
const clampTitle = (str, max) => {
  const s = clamp(str, max);
  return s.trim().length > 0 ? s : "—";
};

const text = (body) => ({ kind: REPLY.TEXT, body: clamp(body, LIMITS.MAX_BODY) });

const buttons = (body, defs) => ({
  kind: REPLY.BUTTONS,
  body: clamp(body, LIMITS.MAX_BODY),
  buttons: Object.entries(defs)
    .slice(0, LIMITS.MAX_BUTTONS)
    .map(([id, title]) => ({ id, title: clampTitle(title, LIMITS.MAX_BUTTON_TITLE) })),
});

const list = (body, button, rows) => {
  if (!rows || rows.length === 0) {
    // A zero-row list is an API rejection at send time. Never build one.
    return text(body);
  }
  return listUnchecked(body, button, rows);
};

const listUnchecked = (body, button, rows) => ({
  kind: REPLY.LIST,
  body: clamp(body, LIMITS.MAX_BODY),
  button: clampTitle(button, LIMITS.MAX_LIST_BUTTON),
  sections: [
    {
      title: "",
      rows: rows.slice(0, LIMITS.MAX_LIST_ROWS).map((r) => ({
        id: r.id,
        title: clampTitle(r.title, LIMITS.MAX_ROW_TITLE),
        description: r.description ? clamp(r.description, LIMITS.MAX_ROW_DESCRIPTION) : undefined,
      })),
    },
  ],
});

const document = (link, filename, caption) => ({
  kind: REPLY.DOCUMENT,
  link,
  filename,
  caption: caption ? clamp(caption, LIMITS.MAX_BODY) : undefined,
});

const template = (name, variables) => ({ kind: REPLY.TEMPLATE, name, variables });

// -------------------------------------------------------------- input reading

/** Lower-cased trimmed value of a user inbound; '' for anything else. */
const valueOf = (inbound) =>
  typeof inbound.value === "string" ? inbound.value.trim().toLowerCase() : "";

const isUserInput = (inbound) =>
  inbound.type === INBOUND.TEXT || inbound.type === INBOUND.BUTTON || inbound.type === INBOUND.LIST;

/**
 * "30000", "30,000", "30 000", "30000L", "30k" → 30000. NaN when it isn't a
 * quantity at all.
 */
const parseLitres = (raw) => {
  let s = String(raw ?? "").trim().toLowerCase();
  s = s.replace(/(liters|litres|ltrs|ltr|l)$/i, "").trim();
  let mult = 1;
  if (s.endsWith("k")) {
    mult = 1000;
    s = s.slice(0, -1);
  }
  s = s.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(Number(s) * mult);
};

// Forgiving: real plates vary; the gate audits and can correct them later.
const isPlausiblePlate = (raw) => {
  const s = String(raw ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9\s-]{3,14}$/.test(s) && /[A-Za-z]/.test(s) && /\d/.test(s);
};

const isPlausibleName = (raw) => {
  const s = String(raw ?? "").trim();
  return s.length >= 2 && s.length <= 60 && /[A-Za-z]/.test(s) && !/^\d+$/.test(s);
};

// ------------------------------------------------------------- context reading

const depotsOf = (context) => (Array.isArray(context.depots) ? context.depots : []);

const findDepot = (context, id) => depotsOf(context).find((d) => String(d.id) === String(id));

const productsOf = (depot) => (depot && Array.isArray(depot.products) ? depot.products : []);

const findProduct = (depot, id) => productsOf(depot).find((p) => String(p.id) === String(id));

/**
 * Even truck split for pickup above one truck's capacity: N = ceil(q/cap),
 * litres spread as evenly as integers allow (first trucks carry the remainder).
 */
const truckSplit = (quantity) => {
  const q = Number(quantity) || 0;
  const count = Math.max(1, Math.ceil(q / TRUCK_CAPACITY_LITRES));
  const base = Math.floor(q / count);
  const extra = q - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
};

// --------------------------------------------------------------- cart & steps

const emptyCart = () => ({});

/**
 * The first unanswered step, in order. Edits jump back by clearing a field
 * (plus its dependents); this sends the customer forward again through only
 * what is missing, then straight to CONFIRM.
 */
const nextStep = (cart) => {
  if (!cart.depotId) return STATES.DEPOT;
  if (!cart.productId) return STATES.PRODUCT;
  if (!cart.quantity) return STATES.QUANTITY;
  if (!cart.deliveryType) return STATES.COLLECT;
  if (cart.deliveryType === "delivery" && !cart.address) return STATES.LOGISTICS;
  if (cart.deliveryType === "pickup" && (cart.plates || []).length < truckSplit(cart.quantity).length)
    return STATES.LOGISTICS;
  return STATES.CONFIRM;
};

/**
 * A cart can outlive its context — a resumed session, or a confirm racing a
 * stock change. Drop whatever context no longer supports, with a line of copy
 * saying so, and let nextStep() walk the customer forward from what survived.
 */
const revalidateCart = (cart, ctx) => {
  if (cart.depotId && !findDepot(ctx, cart.depotId)) {
    return { cart: clearDepot(cart), lead: [text(copy.depotUnavailable())] };
  }
  const depot = findDepot(ctx, cart.depotId);
  if (cart.productId && depot && !findProduct(depot, cart.productId)) {
    return { cart: clearProduct(cart), lead: [text(copy.productUnavailable(depot.name))] };
  }
  const product = findProduct(depot, cart.productId);
  if (cart.quantity && product && Number(cart.quantity) > Number(product.stock)) {
    return {
      cart: clearQuantity(cart),
      lead: [text(copy.quantityOverStock(product.stock, depot.name))],
    };
  }
  return { cart, lead: [] };
};

// Clearing a field invalidates everything priced/sized off it.
const clearDepot = (cart) => {
  const { depotId, productId, quantity, plates, stockOffer, ...rest } = cart;
  return rest;
};
const clearProduct = (cart) => {
  const { productId, quantity, plates, stockOffer, ...rest } = cart;
  return rest;
};
const clearQuantity = (cart) => {
  const { quantity, plates, stockOffer, ...rest } = cart;
  return rest;
};
const clearCollect = (cart) => {
  const { deliveryType, plates, address, ...rest } = cart;
  return rest;
};

// ------------------------------------------------------------------- prompts

/** The question a state asks — reused on entry, resume and re-prompt. */
const promptFor = (state, session, context) => {
  const cart = session.cart || {};
  switch (state) {
    case STATES.IDENTIFY:
      return [text(copy.identifyPrompt())];
    case STATES.MENU:
      return [menuReply(session, context)];
    case STATES.DEPOT:
      return [depotList(cart.page, context)];
    case STATES.PRODUCT: {
      const depot = findDepot(context, cart.depotId);
      if (!depot || productsOf(depot).length === 0) return [depotList(0, context)];
      return [
        list(
          copy.productPrompt(depot.name),
          copy.productListButton(),
          productsOf(depot).map((p) => ({
            id: `product:${p.id}`,
            title: p.name,
            description: copy.productRowDescription(p.price, p.stock),
          }))
        ),
      ];
    }
    case STATES.QUANTITY: {
      const depot = findDepot(context, cart.depotId);
      const product = findProduct(depot, cart.productId);
      if (!depot || !product) return [depotList(0, context)];
      return [text(copy.quantityPrompt(product.name, depot.name, product.stock))];
    }
    case STATES.COLLECT:
      return [buttons(copy.collectPrompt(), copy.collectButtons())];
    case STATES.LOGISTICS: {
      if (cart.deliveryType === "delivery") return [text(copy.addressPrompt())];
      const split = truckSplit(cart.quantity);
      const index = (cart.plates || []).length + 1;
      return [text(copy.platePrompt(index, split.length, split[index - 1] || split[0]))];
    }
    case STATES.CONFIRM:
      return [confirmReply(session, context)];
    case STATES.AWAIT_PAYMENT:
      return cart.awaiting ? [text(copy.awaitPaymentNudge(cart.awaiting))] : [text(copy.helpText())];
    default:
      return [menuReply(session, context)];
  }
};

const menuReply = (session, context) => {
  const name = context.customer ? context.customer.name : null;
  if (depotsOf(context).length === 0) {
    return buttons(copy.noStockAnywhere(), { track: copy.menuButtons().track, help: "Help" });
  }
  const b = copy.menuButtons();
  if (context.lastOrder) {
    const reorder = copy.reorderRow(context.lastOrder);
    return list(copy.menuGreeting(name), "Menu", [
      { id: "order", title: b.order },
      { id: "reorder", title: reorder.title, description: reorder.description },
      { id: "prices", title: b.prices },
      { id: "track", title: b.track },
    ]);
  }
  return buttons(copy.menuGreeting(name), b);
};

/** Depot list with paging: 9 rows + "More ▸" when there are more than 10. */
const depotList = (page, context) => {
  const depots = depotsOf(context).filter((d) => productsOf(d).length > 0);
  if (depots.length === 0) {
    // Nothing orderable anywhere — say so rather than render an empty list.
    return buttons(copy.noStockAnywhere(), { track: copy.menuButtons().track, help: "Help" });
  }
  const rows = depots.map((d) => ({ id: `depot:${d.id}`, title: d.name, description: d.state }));
  if (rows.length <= LIMITS.MAX_LIST_ROWS) {
    return list(copy.depotPrompt(), copy.depotListButton(), rows);
  }
  const pages = Math.ceil(rows.length / PAGE_SIZE);
  const current = ((Number(page) || 0) % pages + pages) % pages; // wraps, never strands
  const slice = rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const more = copy.moreRow();
  return list(copy.depotPrompt(), copy.depotListButton(), [
    ...slice,
    { id: "more", title: more.title, description: more.description },
  ]);
};

const confirmReply = (session, context) => {
  const cart = session.cart || {};
  const depot = findDepot(context, cart.depotId);
  const product = findProduct(depot, cart.productId);
  if (!depot || !product) {
    // Context shifted under the cart (price pulled, stock gone) — re-pick.
    return depotList(0, context);
  }
  const total = (Number(product.price) || 0) * (Number(cart.quantity) || 0);
  let body = copy.confirmSummary({
    productName: product.name,
    quantity: cart.quantity,
    depotName: depot.name,
    deliveryType: cart.deliveryType,
    unitPrice: product.price,
    total,
    plates: cart.plates || [],
    address: cart.address,
  });
  // A wallet that covers the order pays it instantly inside placeOrder — say
  // so BEFORE the tap, so "already paid" never reads as a surprise.
  const balance = Number(context.customer?.balance) || 0;
  if (total > 0 && balance >= total) {
    body += `\n\n${copy.confirmWalletHint(balance)}`;
  }
  return buttons(body, copy.confirmButtons());
};

// --------------------------------------------------------------------- reduce

const reduce = (session, inbound, context) => {
  // Totality: whatever arrives, work with a well-formed view of it.
  const s = session && typeof session === "object" ? session : {};
  const inb = inbound && typeof inbound === "object" ? inbound : { type: INBOUND.UNSUPPORTED };
  const ctx = context && typeof context === "object" ? context : {};
  const state = Object.values(STATES).includes(s.state) ? s.state : STATES.MENU;
  const base = {
    waPhone: s.waPhone,
    customerId: s.customerId,
    state,
    cart: s.cart && typeof s.cart === "object" ? { ...s.cart } : emptyCart(),
    lastOrderId: s.lastOrderId,
    failureCount: Number(s.failureCount) || 0,
  };

  const result = reduceInner(base, inb, ctx, Boolean(s.expired));
  return { ...result, replies: gateReplies(result.replies, ctx) };
};

/** Outside the 24-hour window, only approved templates may leave. */
const gateReplies = (replies, ctx) => {
  if (ctx.withinServiceWindow !== false) return replies;
  return replies.map((r) =>
    r.kind === REPLY.TEMPLATE ? r : template(TEMPLATES.ORDER_UPDATE, { body: r.body || "" })
  );
};

/**
 * Drop undefined-valued keys, recursively. The session persists as jsonb, and
 * JSON has no undefined — a key that would vanish in storage must not exist
 * in the returned object either, or "what we returned" and "what we stored"
 * silently disagree.
 */
const deepCompact = (value) => {
  if (Array.isArray(value)) return value.map(deepCompact);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = deepCompact(v);
    }
    return out;
  }
  return value;
};

const done = (session, replies, effects = []) => ({
  session: deepCompact(session),
  replies,
  effects,
});

/** A successful transition: new state, prompt for it, failure counter reset. */
const goTo = (session, state, ctx, leadReplies = [], effects = []) => {
  const next = { ...session, state, failureCount: 0 };
  return done(next, [...leadReplies, ...promptFor(state, next, ctx)], effects);
};

/** An unparseable input: count it; the third offers the menu instead. */
const fumble = (session, ctx, replies) => {
  const failureCount = session.failureCount + 1;
  const next = { ...session, failureCount };
  if (failureCount >= MAX_FAILURES && next.state !== STATES.IDENTIFY) {
    return done({ ...next, failureCount: 0 }, [
      buttons(copy.threeStrikes(), copy.threeStrikesButtons()),
    ]);
  }
  return done(next, replies);
};

const reduceInner = (session, inbound, ctx, expired) => {
  // 1. Outcomes of effects and payments re-enter here, whatever the state.
  switch (inbound.type) {
    case INBOUND.CUSTOMER_CREATED: {
      const customer = inbound.customer || {};
      const next = {
        ...session,
        customerId: customer.id,
        state: STATES.MENU,
        cart: emptyCart(),
        failureCount: 0,
      };
      // context.customer may not be loaded this turn; greet from the payload.
      const greeting = text(copy.welcome(customer.name || ""));
      return done(next, [greeting, menuReply(next, { ...ctx, customer })]);
    }
    case INBOUND.ORDER_CREATED: {
      const order = inbound.order || {};
      // A covering wallet balance pays the order inside placeOrder itself —
      // it arrives here already Paid. Nothing to await, nothing to transfer.
      const paidFromWallet = order.paymentStatus === "Paid";
      const next = {
        ...session,
        state: paidFromWallet ? STATES.MENU : STATES.AWAIT_PAYMENT,
        lastOrderId: order.id,
        failureCount: 0,
        cart: paidFromWallet
          ? emptyCart()
          : {
              awaiting: {
                orderNumber: order.orderNumber,
                totalAmount: order.totalAmount,
                virtualAccountBank: order.virtualAccountBank,
                virtualAccountNumber: order.virtualAccountNumber,
              },
            },
      };
      const replies = [];
      if (order.invoiceUrl) {
        replies.push(
          document(order.invoiceUrl, `invoice-${order.orderNumber}.pdf`, copy.invoiceCaption(order.orderNumber))
        );
      }
      replies.push(text(paidFromWallet ? copy.orderPaidWallet(order) : copy.orderCreated(order)));
      if (order.deliveryType === "pickup" && ctx.portalUrl) {
        replies.push(text(copy.portalManageHint(ctx.portalUrl)));
      }
      return done(next, replies);
    }
    case INBOUND.ORDER_FAILED: {
      const cart = { ...session.cart };
      delete cart.pendingOrder;
      const next = { ...session, cart };
      if (inbound.reason === "stock") {
        const stock = Number(inbound.stock) || 0;
        if (stock > 0) {
          const depot = findDepot(ctx, cart.depotId);
          return goTo({ ...next, cart: clearQuantity(cart) }, STATES.QUANTITY, ctx, [
            text(copy.orderFailedStock(stock, depot ? depot.name : "that depot")),
          ]);
        }
        const depot = findDepot(ctx, cart.depotId);
        return goTo({ ...next, cart: clearDepot(cart) }, STATES.DEPOT, ctx, [
          text(copy.orderFailedStock(0, depot ? depot.name : "that depot")),
        ]);
      }
      return done({ ...next, state: STATES.CONFIRM }, [
        text(copy.orderFailedGeneric(ctx.supportPhone || "our support line")),
        confirmReply(next, ctx),
      ]);
    }
    case INBOUND.PAYMENT_CONFIRMED: {
      const order = inbound.order || {};
      const next = { ...session, state: STATES.MENU, cart: emptyCart(), failureCount: 0 };
      if (ctx.withinServiceWindow === false) {
        return done(next, [template(TEMPLATES.PAYMENT_RECEIVED, { orderNumber: order.orderNumber || "" })]);
      }
      return done(next, [text(copy.paymentConfirmed(order))]);
    }
    default:
      break;
  }

  // 2. Nobody orders without an identity; nobody Inactive orders at all.
  if (!ctx.customer && session.state !== STATES.IDENTIFY) {
    return goTo({ ...session, cart: emptyCart() }, STATES.IDENTIFY, ctx);
  }
  if (ctx.customer && ctx.customer.status && ctx.customer.status !== "Active") {
    return done(session, [text(copy.inactiveCustomer(ctx.supportPhone || "our support line"))]);
  }

  // 3. Media we cannot read is a real case with a real reply, not a crash.
  if (!isUserInput(inbound)) {
    return fumble(session, ctx, [
      text(copy.unsupportedType()),
      ...promptFor(session.state, session, ctx),
    ]);
  }

  const value = valueOf(inbound);

  // 4. Global commands beat state — one word that always works.
  if (COMMANDS.MENU.includes(value)) {
    return goTo(session, STATES.MENU, ctx);
  }
  if (COMMANDS.CANCEL.includes(value)) {
    return goTo({ ...session, cart: emptyCart() }, STATES.MENU, ctx, [text(copy.cancelled())]);
  }
  if (COMMANDS.HELP.includes(value)) {
    return done(session, [text(copy.helpText())]);
  }
  if (COMMANDS.TRACK.includes(value)) {
    const reply = ctx.lastOrder ? text(copy.trackStatus(ctx.lastOrder)) : text(copy.trackNoOrder());
    return done(session, [reply]); // state untouched — track is an action
  }
  if (value === "retry") {
    // The three-strikes "Try again" button: re-ask, with the slate clean.
    const next = { ...session, failureCount: 0 };
    return done(next, promptFor(session.state, next, ctx));
  }

  // 5. A timed-out cart is offered back, not silently dropped.
  if (expired && Object.keys(session.cart).length > 0 && !session.cart.resumeState) {
    const depot = findDepot(ctx, session.cart.depotId);
    const product = findProduct(depot, session.cart.productId);
    const next = {
      ...session,
      state: STATES.MENU,
      cart: { ...session.cart, resumeState: session.state },
    };
    return done(next, [
      buttons(
        copy.expiredResume({
          productName: product ? product.name : undefined,
          quantity: session.cart.quantity,
          depotName: depot ? depot.name : undefined,
        }),
        copy.resumeButtons()
      ),
    ]);
  }
  if (session.cart.resumeState) {
    if (value === "resume") {
      const { resumeState, ...stale } = session.cart;
      const { cart, lead } = revalidateCart(stale, ctx);
      return goTo({ ...session, cart }, nextStep(cart), ctx, lead);
    }
    if (value === "startover") {
      return goTo({ ...session, cart: emptyCart() }, STATES.MENU, ctx);
    }
  }

  // 6. The state switch.
  switch (session.state) {
    case STATES.IDENTIFY:
      return handleIdentify(session, inbound, ctx, value);
    case STATES.MENU:
      return handleMenu(session, ctx, value);
    case STATES.DEPOT:
      return handleDepot(session, ctx, value);
    case STATES.PRODUCT:
      return handleProduct(session, ctx, value);
    case STATES.QUANTITY:
      return handleQuantity(session, inbound, ctx, value);
    case STATES.COLLECT:
      return handleCollect(session, ctx, value);
    case STATES.LOGISTICS:
      return handleLogistics(session, inbound, ctx);
    case STATES.CONFIRM:
      return handleConfirm(session, ctx, value);
    case STATES.AWAIT_PAYMENT:
      return done(session, promptFor(STATES.AWAIT_PAYMENT, session, ctx));
    default:
      return goTo(session, STATES.MENU, ctx);
  }
};

// ------------------------------------------------------------ state handlers

const handleIdentify = (session, inbound, ctx, value) => {
  if (session.cart.pendingCustomer) {
    return done(session, [text(copy.orderPending())]);
  }
  const name = typeof inbound.value === "string" ? inbound.value.trim() : "";
  if (inbound.type === INBOUND.TEXT && isPlausibleName(name)) {
    const next = { ...session, cart: { pendingCustomer: true } };
    return done(next, [], [
      { type: EFFECTS.CREATE_CUSTOMER, payload: { name, waPhone: session.waPhone } },
    ]);
  }
  // No menu escape hatch here — there is nothing a nameless menu can do.
  return done({ ...session, failureCount: session.failureCount + 1 }, [
    text(copy.identifyInvalidName()),
  ]);
};

const handleMenu = (session, ctx, value) => {
  if (value === "order") {
    if (depotsOf(ctx).length === 0) {
      return done(session, [text(copy.noStockAnywhere())]);
    }
    return goTo({ ...session, cart: emptyCart() }, STATES.DEPOT, ctx);
  }
  if (value === "prices") {
    return done(session, [pricesReply(ctx)]);
  }
  if (value === "reorder" && ctx.lastOrder) {
    const last = ctx.lastOrder;
    const depot = findDepot(ctx, last.depotId);
    const product = findProduct(depot, last.productId);
    if (!depot || !product || Number(product.stock) < Number(last.quantity)) {
      return goTo({ ...session, cart: emptyCart() }, STATES.DEPOT, ctx, [
        text(copy.depotUnavailable()),
      ]);
    }
    const cart = {
      depotId: last.depotId,
      productId: last.productId,
      quantity: last.quantity,
      deliveryType: last.deliveryType,
    };
    return goTo({ ...session, cart }, nextStep(cart), ctx);
  }
  return fumble(session, ctx, [menuReply(session, ctx)]);
};

const pricesReply = (ctx) => {
  const depots = depotsOf(ctx);
  if (depots.length === 0) return text(copy.noStockAnywhere());
  let body = copy.pricesHeader();
  for (const depot of depots) {
    const parts = productsOf(depot).map((p) => copy.pricesProductPart(p.name, p.price));
    if (parts.length > 0) body += copy.pricesDepotLine(depot.name, parts);
  }
  return text(body + copy.pricesFooter());
};

const handleDepot = (session, ctx, value) => {
  if (value === "more") {
    const cart = { ...session.cart, page: (Number(session.cart.page) || 0) + 1 };
    return done({ ...session, cart, failureCount: 0 }, [depotList(cart.page, ctx)]);
  }
  const id = value.startsWith("depot:") ? value.slice("depot:".length) : null;
  const depot = id
    ? findDepot(ctx, id)
    : depotsOf(ctx).find((d) => String(d.name).toLowerCase() === value);
  if (depot) {
    const cart = { ...clearDepot(session.cart), depotId: depot.id };
    return goTo({ ...session, cart }, nextStep(cart), ctx);
  }
  return fumble(session, ctx, [depotList(session.cart.page, ctx)]);
};

const handleProduct = (session, ctx, value) => {
  const depot = findDepot(ctx, session.cart.depotId);
  if (!depot) {
    // Depot vanished from context (price pulled, stock gone) — re-pick.
    return goTo({ ...session, cart: clearDepot(session.cart) }, STATES.DEPOT, ctx, [
      text(copy.depotUnavailable()),
    ]);
  }
  const id = value.startsWith("product:") ? value.slice("product:".length) : null;
  const product = id
    ? findProduct(depot, id)
    : productsOf(depot).find((p) => String(p.name).toLowerCase() === value);
  if (product) {
    const cart = { ...clearProduct(session.cart), productId: product.id };
    return goTo({ ...session, cart }, nextStep(cart), ctx);
  }
  return fumble(session, ctx, [
    text(copy.productUnavailable(depot.name)),
    ...promptFor(STATES.PRODUCT, session, ctx),
  ]);
};

const handleQuantity = (session, inbound, ctx, value) => {
  const depot = findDepot(ctx, session.cart.depotId);
  const product = findProduct(depot, session.cart.productId);
  if (!depot || !product) {
    return goTo({ ...session, cart: clearDepot(session.cart) }, STATES.DEPOT, ctx, [
      text(copy.depotUnavailable()),
    ]);
  }

  // Standing over-stock offer: "we have 45,000 L — want that instead?"
  if (session.cart.stockOffer) {
    if (value === "takestock") {
      const cart = { ...clearQuantity(session.cart), quantity: session.cart.stockOffer };
      return goTo({ ...session, cart }, nextStep(cart), ctx);
    }
    if (value === "changedepot") {
      return goTo({ ...session, cart: clearDepot(session.cart) }, STATES.DEPOT, ctx);
    }
    // Anything else falls through — maybe they typed a new quantity.
  }

  const qty = parseLitres(inbound.value);
  if (Number.isNaN(qty) || qty <= 0) {
    return fumble(session, ctx, [text(copy.quantityInvalid())]);
  }
  if (qty < MIN_ORDER_LITRES) {
    return fumble(session, ctx, [text(copy.quantityBelowMin(MIN_ORDER_LITRES))]);
  }
  if (qty > MAX_ORDER_LITRES) {
    return fumble(session, ctx, [text(copy.quantityAboveCap(MAX_ORDER_LITRES))]);
  }
  const stock = Number(product.stock) || 0;
  if (qty > stock) {
    const cart = { ...session.cart, stockOffer: stock };
    return done({ ...session, cart, failureCount: 0 }, [
      buttons(copy.quantityOverStock(stock, depot.name), copy.overStockButtons(stock)),
    ]);
  }
  const cart = { ...clearQuantity(session.cart), quantity: qty };
  return goTo({ ...session, cart }, nextStep(cart), ctx);
};

const handleCollect = (session, ctx, value) => {
  if (value === "pickup" || value === "delivery") {
    const cart = { ...clearCollect(session.cart), deliveryType: value };
    return goTo({ ...session, cart }, nextStep(cart), ctx);
  }
  return fumble(session, ctx, promptFor(STATES.COLLECT, session, ctx));
};

const handleLogistics = (session, inbound, ctx) => {
  const cart = session.cart;
  if (cart.deliveryType === "delivery") {
    const address = typeof inbound.value === "string" ? inbound.value.trim() : "";
    if (inbound.type === INBOUND.TEXT && address.length >= 10) {
      const next = { ...cart, address };
      return goTo({ ...session, cart: next }, nextStep(next), ctx);
    }
    return fumble(session, ctx, [text(copy.addressInvalid())]);
  }
  // Pickup: collect plates one truck at a time.
  const plate = typeof inbound.value === "string" ? inbound.value.trim().toUpperCase() : "";
  if (inbound.type === INBOUND.TEXT && isPlausiblePlate(plate)) {
    const plates = [...(cart.plates || []), plate];
    const next = { ...cart, plates };
    return goTo({ ...session, cart: next }, nextStep(next), ctx);
  }
  return fumble(session, ctx, [text(copy.plateInvalid())]);
};

const handleConfirm = (session, ctx, value) => {
  const cart = session.cart;

  if (cart.pendingOrder) {
    // The effect is out; a second tap must not order twice.
    return done(session, [text(copy.orderPending())]);
  }

  if (value.startsWith("edit:")) {
    const field = value.slice("edit:".length);
    const cleared =
      field === "depot"
        ? clearDepot(cart)
        : field === "product"
          ? clearProduct(cart)
          : field === "quantity"
            ? clearQuantity(cart)
            : field === "collect"
              ? clearCollect(cart)
              : null;
    if (cleared) {
      return goTo({ ...session, cart: cleared }, nextStep(cleared), ctx);
    }
  }

  if (value === "edit") {
    const rows = copy.editRows();
    return done(session, [
      list(copy.editPrompt(), copy.editListButton(), [
        { id: "edit:depot", title: rows.depot.title },
        { id: "edit:product", title: rows.product.title },
        { id: "edit:quantity", title: rows.quantity.title },
        { id: "edit:collect", title: rows.collect.title },
      ]),
    ]);
  }

  if (value === "confirm") {
    const { cart: valid, lead } = revalidateCart(cart, ctx);
    if (valid !== cart || nextStep(valid) !== STATES.CONFIRM) {
      // Context shifted under the cart — walk the missing step, don't fail.
      return goTo({ ...session, cart: valid }, nextStep(valid), ctx, lead);
    }
    const depot = findDepot(ctx, cart.depotId);
    const product = findProduct(depot, cart.productId);
    const payload = {
      customerId: session.customerId,
      state: depot.state,
      depotId: cart.depotId,
      productId: cart.productId,
      quantity: cart.quantity,
      deliveryType: cart.deliveryType,
    };
    if (cart.deliveryType === "pickup") {
      const split = truckSplit(cart.quantity);
      // truckNumber, not plateNumber: this payload feeds placeOrder verbatim.
      payload.trucks = (cart.plates || []).map((plate, i) => ({
        truckNumber: plate,
        quantity: split[i],
      }));
    } else {
      payload.address = cart.address;
    }
    const next = { ...session, cart: { ...cart, pendingOrder: true } };
    return done(next, [text(copy.orderPending())], [{ type: EFFECTS.CREATE_ORDER, payload }]);
  }

  return fumble(session, ctx, [confirmReply(session, ctx)]);
};

module.exports = {
  reduce,
  // Pure helpers exported for direct unit- and property-testing.
  parseLitres,
  truckSplit,
  nextStep,
  isPlausiblePlate,
  isPlausibleName,
};
