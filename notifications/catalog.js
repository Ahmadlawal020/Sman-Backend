const {
  escapeHtml,
  formatMoney,
  formatQuantity,
  formatDate,
  detailRows,
  callToAction,
  callout,
  layout,
} = require("./templates/email");

/**
 * The notification catalog — every kind of notification the platform can send,
 * declared in one file.
 *
 * An entry answers five questions and nothing else:
 *
 *   who is it for   → `audience` ("customer" | "staff")
 *   what is it about→ `category` (the unit preferences are expressed in)
 *   how loud is it  → `priority` (drives quiet-hours suppression)
 *   where does it go→ `channels` (the DEFAULT set; preferences narrow it)
 *   what does it say→ `title` / `body`, plus optional per-channel overrides
 *
 * Business code never writes copy. It calls
 * `notify("order.released", { recipient, data })` and the wording, the routing
 * and the deep link are decided here. That is what makes it possible to change
 * an SMS, add push to a flow, or mute a whole category without touching a
 * controller.
 *
 * DATA CONTRACT: each entry documents the `data` fields its templates read.
 * Templates must tolerate missing fields — an event emitted from a code path
 * that forgot a field should degrade to a vaguer sentence, never throw, because
 * a template crash would take out the notification AND everything queued
 * behind it.
 */

const CHANNELS = Object.freeze({
  IN_APP: "in_app",
  PUSH: "push",
  EMAIL: "email",
  SMS: "sms",
});

// The common shapes, named so entries read as intent rather than as arrays.
const ALL = [CHANNELS.IN_APP, CHANNELS.PUSH, CHANNELS.EMAIL, CHANNELS.SMS];
const APP_ONLY = [CHANNELS.IN_APP, CHANNELS.PUSH];
const APP_AND_EMAIL = [CHANNELS.IN_APP, CHANNELS.PUSH, CHANNELS.EMAIL];
const APP_AND_SMS = [CHANNELS.IN_APP, CHANNELS.PUSH, CHANNELS.SMS];
const EMAIL_ONLY = [CHANNELS.EMAIL];

// ─── Link helpers ───────────────────────────────────────────────────────────

const trimSlash = (s) => String(s || "").replace(/\/+$/, "");

/** The admin dashboard's origin. */
const adminBase = () => trimSlash(process.env.ADMIN_URL || process.env.CLIENT_URL || "");
/** The customer portal / web app's origin. */
const portalBase = () => trimSlash(process.env.PORTAL_URL || process.env.CLIENT_URL || "");

const adminLink = (path) => (adminBase() ? `${adminBase()}${path}` : null);
const portalLink = (path) => (portalBase() ? `${portalBase()}${path}` : null);

// ─── Copy helpers ───────────────────────────────────────────────────────────

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";
/** "Dear Ada, " or "" — never "Dear undefined, ". */
const greet = (name, { formal = true } = {}) => {
  const n = String(name || "").trim();
  if (!n) return "";
  return formal ? `Dear ${n}, ` : `Hi ${firstName(n)}, `;
};
const ref = (d) => d.reference || d.orderNumber || d.requestNumber || d.ticketNumber || "";

/** The generic branded email used when a type has no bespoke document. */
const simpleEmail = ({ subtitle, heading, intro, rows = [], cta, note, tone }) => ({
  subject: heading,
  html: layout({
    subtitle,
    heading,
    intro,
    bodyHtml: [
      rows.length ? detailRows(rows) : "",
      cta?.url ? callToAction(cta.url, cta.label) : "",
      note ? callout(escapeHtml(note), tone || "info") : "",
    ].join(""),
    footNote: "If you have any questions, please contact our support team.",
  }),
});

// ─── The catalog ────────────────────────────────────────────────────────────

const CATALOG = {
  // ═══ Orders (customer) ════════════════════════════════════════════════════

  /** data: orderId, orderNumber, reference, customerName, product, quantity, unit,
   *        totalAmount, depotName, deliveryType, accountNumber, bankName, accountName */
  "order.created": {
    audience: "customer",
    category: "orders",
    priority: "high",
    channels: APP_ONLY, // email + SMS are sent by order.service's bespoke invoice
    title: (d) => `Order ${ref(d)} received`,
    body: (d) =>
      `Your order for ${formatQuantity(d.quantity, d.unit)} of ${d.product || "fuel"} is awaiting payment` +
      (d.totalAmount ? ` — ${formatMoney(d.totalAmount, { decimals: 0 })}.` : "."),
    entity: (d) => ({ type: "order", id: d.orderId }),
    data: (d) => ({ screen: "OrderDetail", orderId: d.orderId, orderNumber: ref(d) }),
    actionUrl: (d) => portalLink(`/orders/${d.orderId}`),
    dedupe: (d) => (d.orderId ? `order.created:${d.orderId}` : null),
  },

  /** data: orderId, orderNumber, reference, customerName, totalAmount, amountPaid */
  "order.paid": {
    audience: "customer",
    category: "payments",
    priority: "urgent", // money landed; never hold this for quiet hours
    channels: ALL,
    title: (d) => `Payment confirmed for ${ref(d)}`,
    body: (d) =>
      `We've received your payment${d.amountPaid ? ` of ${formatMoney(d.amountPaid, { decimals: 0 })}` : ""}. ` +
      `Your order is now being prepared.`,
    entity: (d) => ({ type: "order", id: d.orderId }),
    data: (d) => ({ screen: "OrderDetail", orderId: d.orderId, orderNumber: ref(d) }),
    actionUrl: (d) => portalLink(`/orders/${d.orderId}`),
    dedupe: (d) => (d.orderId ? `order.paid:${d.orderId}` : null),
    sms: (d) =>
      `${greet(d.customerName)}payment for order ${ref(d)}` +
      `${d.amountPaid ? ` of ${formatMoney(d.amountPaid, { decimals: 0 })}` : ""} has been confirmed. ` +
      `Your order is being prepared. Thank you for choosing Soroman!`,
    email: (d) =>
      simpleEmail({
        subtitle: "Payment Confirmed",
        heading: `Payment received for order ${ref(d)}`,
        intro: `${greet(d.customerName)}we've confirmed your payment. Your order is now being prepared.`,
        rows: [
          { label: "Order Reference", value: ref(d) },
          { label: "Amount Received", value: formatMoney(d.amountPaid ?? d.totalAmount), strong: true },
          { label: "Product", value: d.product },
          { label: "Quantity", value: formatQuantity(d.quantity, d.unit) },
        ],
        cta: { url: portalLink(`/orders/${d.orderId}`), label: "View Order" },
      }),
  },

  /** data: orderId, orderNumber, reference, customerName, depotName, ticketNumber */
  "order.released": {
    audience: "customer",
    category: "orders",
    priority: "high",
    channels: APP_AND_SMS,
    title: (d) => `Order ${ref(d)} released`,
    body: (d) =>
      `Your order has been released${d.depotName ? ` at ${d.depotName}` : ""} and is ready for loading.`,
    entity: (d) => ({ type: "order", id: d.orderId }),
    data: (d) => ({ screen: "OrderDetail", orderId: d.orderId, orderNumber: ref(d) }),
    actionUrl: (d) => portalLink(`/orders/${d.orderId}`),
    dedupe: (d) => (d.orderId ? `order.released:${d.orderId}` : null),
    sms: (d) =>
      `${greet(d.customerName)}your order ${ref(d)} has been released` +
      `${d.depotName ? ` at ${d.depotName}` : ""} and is ready for loading. Thank you for choosing Soroman!`,
  },

  /** data: orderId, reference, customerName, truckNumber, depotName */
  "order.loading": {
    audience: "customer",
    category: "orders",
    priority: "normal",
    channels: APP_ONLY,
    title: (d) => `Loading started for ${ref(d)}`,
    body: (d) =>
      `${d.truckNumber ? `Truck ${d.truckNumber} has` : "Your first truck has"} gated in` +
      `${d.depotName ? ` at ${d.depotName}` : ""}. Loading is under way.`,
    entity: (d) => ({ type: "order", id: d.orderId }),
    data: (d) => ({ screen: "OrderDetail", orderId: d.orderId, orderNumber: ref(d) }),
    actionUrl: (d) => portalLink(`/orders/${d.orderId}`),
    dedupe: (d) => (d.orderId ? `order.loading:${d.orderId}` : null),
  },

  /** data: orderId, reference, customerName, quantity, unit, product */
  "order.completed": {
    audience: "customer",
    category: "orders",
    priority: "normal",
    channels: APP_AND_SMS,
    title: (d) => `Order ${ref(d)} completed`,
    body: (d) =>
      `All trucks have gated out. Your order${d.quantity ? ` of ${formatQuantity(d.quantity, d.unit)}` : ""} is complete.`,
    entity: (d) => ({ type: "order", id: d.orderId }),
    data: (d) => ({ screen: "OrderDetail", orderId: d.orderId, orderNumber: ref(d) }),
    actionUrl: (d) => portalLink(`/orders/${d.orderId}`),
    dedupe: (d) => (d.orderId ? `order.completed:${d.orderId}` : null),
    sms: (d) =>
      `${greet(d.customerName)}your order ${ref(d)} is complete. ` +
      `Thank you for choosing Soroman!`,
  },

  /** data: orderId, reference, customerName, reason */
  "order.cancelled": {
    audience: "customer",
    category: "orders",
    priority: "high",
    channels: APP_AND_SMS,
    title: (d) => `Order ${ref(d)} cancelled`,
    body: (d) => `Your order has been cancelled.${d.reason ? ` Reason: ${d.reason}` : ""}`,
    entity: (d) => ({ type: "order", id: d.orderId }),
    data: (d) => ({ screen: "OrderDetail", orderId: d.orderId, orderNumber: ref(d) }),
    actionUrl: (d) => portalLink(`/orders/${d.orderId}`),
    dedupe: (d) => (d.orderId ? `order.cancelled:${d.orderId}` : null),
    sms: (d) =>
      `${greet(d.customerName)}your Soroman order ${ref(d)} has been cancelled.` +
      `${d.reason ? ` Reason: ${d.reason}` : ""}`,
  },

  /** data: orderId, orderNumber, reference, customerName — SMS is sent by order.service */
  "order.expired": {
    audience: "customer",
    category: "orders",
    priority: "high",
    channels: APP_ONLY,
    title: (d) => `Order ${ref(d)} expired`,
    body: () =>
      "Payment wasn't received in time, so the price is no longer held. " +
      "Place a new order at today's prices whenever you're ready.",
    entity: (d) => ({ type: "order", id: d.orderId }),
    data: (d) => ({ screen: "OrderDetail", orderId: d.orderId, orderNumber: ref(d) }),
    actionUrl: (d) => portalLink(`/orders/${d.orderId}`),
    dedupe: (d) => (d.orderId ? `order.expired:${d.orderId}` : null),
  },

  /** data: orderId, ticketId, ticketNumber, reference, customerName, deliveryType, depotName */
  "ticket.issued": {
    audience: "customer",
    category: "tickets",
    priority: "high",
    channels: APP_ONLY, // the QR-code email + SMS are ticket.service's bespoke pair
    title: (d) =>
      d.deliveryType === "delivery" ? `Order ${ref(d)} confirmed` : `Pickup ticket ${d.ticketNumber} ready`,
    body: (d) =>
      d.deliveryType === "delivery"
        ? `Your order is confirmed and being prepared for delivery.`
        : `Present this ticket at ${d.depotName || "the depot"} to collect your product.`,
    entity: (d) => ({ type: "ticket", id: d.ticketId || d.ticketNumber }),
    data: (d) => ({
      screen: "TicketDetail",
      ticketId: d.ticketId,
      ticketNumber: d.ticketNumber,
      orderId: d.orderId,
    }),
    actionUrl: (d) => portalLink(`/orders/${d.orderId}`),
    dedupe: (d) => (d.ticketNumber ? `ticket.issued:${d.ticketNumber}` : null),
  },

  /** data: ticketId, ticketNumber, orderId, customerName, redeemedAt, depotName */
  "ticket.redeemed": {
    audience: "customer",
    category: "tickets",
    priority: "normal",
    channels: APP_ONLY,
    title: (d) => `Ticket ${d.ticketNumber} redeemed`,
    body: (d) =>
      `Your ticket was scanned${d.depotName ? ` at ${d.depotName}` : ""}. ` +
      `If this wasn't you, contact Soroman immediately.`,
    entity: (d) => ({ type: "ticket", id: d.ticketId || d.ticketNumber }),
    data: (d) => ({ screen: "TicketDetail", ticketId: d.ticketId, ticketNumber: d.ticketNumber }),
    dedupe: (d) => (d.ticketNumber ? `ticket.redeemed:${d.ticketNumber}` : null),
  },

  // ═══ Dangote bulk requests (customer) ═════════════════════════════════════

  /** data: requestId, requestNumber, customerName, product, quantity, quantityUnit */
  "dangote.request_received": {
    audience: "customer",
    category: "orders",
    priority: "normal",
    channels: APP_ONLY, // the bespoke "received" email is sent by the controller
    title: (d) => `Request ${d.requestNumber} received`,
    body: (d) =>
      `Your Dangote delivery request${d.quantity ? ` for ${formatQuantity(d.quantity, d.quantityUnit)}` : ""} ` +
      `is under review. We'll confirm pricing shortly.`,
    entity: (d) => ({ type: "dangote_request", id: d.requestId }),
    data: (d) => ({ screen: "DangoteOrderDetail", requestId: d.requestId, requestNumber: d.requestNumber }),
    actionUrl: (d) => portalLink(`/dangote-orders/${d.requestId}`),
    dedupe: (d) => (d.requestId ? `dangote.request_received:${d.requestId}` : null),
  },

  /** data: requestId, requestNumber, customerName, totalAmount, product, quantity, quantityUnit */
  "dangote.confirmed": {
    audience: "customer",
    category: "orders",
    priority: "high",
    channels: APP_ONLY, // bespoke confirmation email + SMS sent by the controller
    title: (d) => `Dangote order ${d.requestNumber} confirmed`,
    body: (d) =>
      `Your request has been approved${d.totalAmount ? ` at ${formatMoney(d.totalAmount, { decimals: 0 })}` : ""}. ` +
      `Payment details have been sent to you.`,
    entity: (d) => ({ type: "dangote_request", id: d.requestId }),
    data: (d) => ({ screen: "DangoteOrderDetail", requestId: d.requestId, requestNumber: d.requestNumber }),
    actionUrl: (d) => portalLink(`/dangote-orders/${d.requestId}`),
    dedupe: (d) => (d.requestId ? `dangote.confirmed:${d.requestId}` : null),
  },

  /** data: requestId, requestNumber, customerName — SMS sent by requestExpiry.service */
  "dangote.expired": {
    audience: "customer",
    category: "orders",
    priority: "high",
    channels: APP_ONLY,
    title: (d) => `Dangote order ${d.requestNumber} expired`,
    body: () =>
      "Payment wasn't received in time, so the price is no longer held. " +
      "Submit a new request at today's prices whenever you're ready.",
    entity: (d) => ({ type: "dangote_request", id: d.requestId }),
    data: (d) => ({ screen: "DangoteOrderDetail", requestId: d.requestId, requestNumber: d.requestNumber }),
    dedupe: (d) => (d.requestId ? `dangote.expired:${d.requestId}` : null),
  },

  /** data: requestId, requestNumber, customerName, reason */
  "dangote.rejected": {
    audience: "customer",
    category: "orders",
    priority: "high",
    channels: APP_AND_SMS,
    title: (d) => `Dangote request ${d.requestNumber} declined`,
    body: (d) => `We couldn't proceed with this request.${d.reason ? ` Reason: ${d.reason}` : ""}`,
    entity: (d) => ({ type: "dangote_request", id: d.requestId }),
    data: (d) => ({ screen: "DangoteOrderDetail", requestId: d.requestId, requestNumber: d.requestNumber }),
    dedupe: (d) => (d.requestId ? `dangote.rejected:${d.requestId}` : null),
    sms: (d) =>
      `${greet(d.customerName, { formal: false })}your Dangote request ${d.requestNumber} was declined.` +
      `${d.reason ? ` Reason: ${d.reason}` : ""} Contact Soroman for help.`,
  },

  // ═══ LPG cooking gas (customer) ═══════════════════════════════════════════

  /** data: requestId, requestNumber, customerName, cylinderSizeKg, cylinderQuantity */
  "lpg.request_received": {
    audience: "customer",
    category: "orders",
    priority: "normal",
    channels: APP_ONLY,
    title: (d) => `LPG request ${d.requestNumber} received`,
    body: (d) =>
      `Your cooking gas request` +
      `${d.cylinderQuantity ? ` for ${d.cylinderQuantity} × ${d.cylinderSizeKg}kg cylinder(s)` : ""}` +
      ` is under review. We'll confirm pricing shortly.`,
    entity: (d) => ({ type: "lpg_request", id: d.requestId }),
    data: (d) => ({ screen: "LpgOrderDetail", requestId: d.requestId, requestNumber: d.requestNumber }),
    actionUrl: (d) => portalLink(`/lpg-orders/${d.requestId}`),
    dedupe: (d) => (d.requestId ? `lpg.request_received:${d.requestId}` : null),
  },

  /** data: requestId, requestNumber, customerName, totalAmount, cylinderSizeKg, cylinderQuantity */
  "lpg.confirmed": {
    audience: "customer",
    category: "orders",
    priority: "high",
    channels: APP_ONLY,
    title: (d) => `LPG order ${d.requestNumber} confirmed`,
    body: (d) =>
      `Your cooking gas order has been approved` +
      `${d.totalAmount ? ` at ${formatMoney(d.totalAmount, { decimals: 0 })}` : ""}. ` +
      `Payment details have been sent to you.`,
    entity: (d) => ({ type: "lpg_request", id: d.requestId }),
    data: (d) => ({ screen: "LpgOrderDetail", requestId: d.requestId, requestNumber: d.requestNumber }),
    actionUrl: (d) => portalLink(`/lpg-orders/${d.requestId}`),
    dedupe: (d) => (d.requestId ? `lpg.confirmed:${d.requestId}` : null),
  },

  /** data: requestId, requestNumber, customerName — SMS sent by requestExpiry.service */
  "lpg.expired": {
    audience: "customer",
    category: "orders",
    priority: "high",
    channels: APP_ONLY,
    title: (d) => `LPG order ${d.requestNumber} expired`,
    body: () =>
      "Payment wasn't received in time, so the price is no longer held. " +
      "Submit a new order at today's prices whenever you're ready.",
    entity: (d) => ({ type: "lpg_request", id: d.requestId }),
    data: (d) => ({ screen: "LpgOrderDetail", requestId: d.requestId, requestNumber: d.requestNumber }),
    dedupe: (d) => (d.requestId ? `lpg.expired:${d.requestId}` : null),
  },

  /** data: requestId, requestNumber, customerName, deliveredAt */
  "lpg.delivered": {
    audience: "customer",
    category: "delivery",
    priority: "normal",
    channels: APP_AND_SMS,
    title: (d) => `LPG order ${d.requestNumber} delivered`,
    body: () => "Your cooking gas has been delivered. Thank you for choosing Soroman!",
    entity: (d) => ({ type: "lpg_request", id: d.requestId }),
    data: (d) => ({ screen: "LpgOrderDetail", requestId: d.requestId, requestNumber: d.requestNumber }),
    dedupe: (d) => (d.requestId ? `lpg.delivered:${d.requestId}` : null),
    sms: (d) =>
      `${greet(d.customerName, { formal: false })}your LPG order ${d.requestNumber} has been delivered. ` +
      `Thank you for choosing Soroman!`,
  },

  // ═══ Wallet & payments (customer) ═════════════════════════════════════════

  /** data: amount, balanceAfter, reference, description, customerName */
  "wallet.credited": {
    audience: "customer",
    category: "payments",
    priority: "urgent",
    channels: APP_AND_SMS,
    title: (d) => `${formatMoney(d.amount, { decimals: 0 })} credited`,
    body: (d) =>
      `Your Soroman wallet has been credited.` +
      `${d.balanceAfter !== undefined ? ` New balance: ${formatMoney(d.balanceAfter, { decimals: 0 })}.` : ""}`,
    entity: (d) => ({ type: "wallet", id: d.reference || "" }),
    data: (d) => ({ screen: "Wallet", reference: d.reference, amount: d.amount }),
    actionUrl: () => portalLink("/wallet"),
    dedupe: (d) => (d.reference ? `wallet.credited:${d.reference}` : null),
    sms: (d) =>
      `${greet(d.customerName)}your Soroman wallet has been credited with ${formatMoney(d.amount, { decimals: 0 })}.` +
      `${d.balanceAfter !== undefined ? ` New balance: ${formatMoney(d.balanceAfter, { decimals: 0 })}.` : ""}`,
  },

  /** data: amount, balanceAfter, reference, description, customerName */
  "wallet.debited": {
    audience: "customer",
    category: "payments",
    priority: "high",
    channels: APP_ONLY,
    title: (d) => `${formatMoney(d.amount, { decimals: 0 })} debited`,
    body: (d) =>
      `${d.description || "A debit was applied to your wallet."}` +
      `${d.balanceAfter !== undefined ? ` New balance: ${formatMoney(d.balanceAfter, { decimals: 0 })}.` : ""}`,
    entity: (d) => ({ type: "wallet", id: d.reference || "" }),
    data: (d) => ({ screen: "Wallet", reference: d.reference, amount: d.amount }),
    actionUrl: () => portalLink("/wallet"),
    dedupe: (d) => (d.reference ? `wallet.debited:${d.reference}` : null),
  },

  /** data: commissionId, orderNumber, commissionAmount, customerName */
  "commission.earned": {
    audience: "customer",
    category: "payments",
    priority: "normal",
    channels: APP_ONLY,
    title: (d) => `Commission earned: ${formatMoney(d.commissionAmount, { decimals: 0 })}`,
    body: (d) => `You earned commission on order ${d.orderNumber || ""}. It's pending payout.`,
    entity: (d) => ({ type: "commission", id: d.commissionId }),
    data: (d) => ({ screen: "Commissions", commissionId: d.commissionId }),
    actionUrl: () => portalLink("/commissions"),
    dedupe: (d) => (d.commissionId ? `commission.earned:${d.commissionId}` : null),
  },

  /** data: commissionId, commissionAmount, customerName, accountNumber, bankName */
  "commission.paid": {
    audience: "customer",
    category: "payments",
    priority: "high",
    channels: APP_AND_SMS,
    title: (d) => `Commission paid: ${formatMoney(d.commissionAmount, { decimals: 0 })}`,
    body: (d) =>
      `Your commission has been paid out` +
      `${d.bankName ? ` to your ${d.bankName} account` : ""}.`,
    entity: (d) => ({ type: "commission", id: d.commissionId }),
    data: (d) => ({ screen: "Commissions", commissionId: d.commissionId }),
    actionUrl: () => portalLink("/commissions"),
    dedupe: (d) => (d.commissionId ? `commission.paid:${d.commissionId}` : null),
    sms: (d) =>
      `${greet(d.customerName)}your Soroman commission of ${formatMoney(d.commissionAmount, { decimals: 0 })} ` +
      `has been paid out${d.bankName ? ` to your ${d.bankName} account` : ""}.`,
  },

  // ═══ Delivery / ERP (customer) ════════════════════════════════════════════

  /** data: allocationCode, truckNumber, quantityAllocated, customerName, deliveryId */
  "delivery.released": {
    audience: "customer",
    category: "delivery",
    priority: "high",
    channels: APP_AND_SMS,
    title: (d) => `Delivery ${d.allocationCode || ""} released`.trim(),
    body: (d) =>
      `Truck ${d.truckNumber || "TBA"} has been released with ` +
      `${Number(d.quantityAllocated || 0).toLocaleString()}L.`,
    entity: (d) => ({ type: "delivery", id: d.deliveryId || d.allocationCode }),
    data: (d) => ({ screen: "DeliveryDetail", allocationCode: d.allocationCode, truckNumber: d.truckNumber }),
    dedupe: (d) => (d.allocationCode ? `delivery.released:${d.allocationCode}` : null),
    // Preserves the exact wording the previous notification.service.js sent.
    sms: (d) =>
      `Soroman: your delivery ${d.allocationCode || ""} has been released. ` +
      `Truck ${d.truckNumber || "TBA"}, ${Number(d.quantityAllocated || 0).toLocaleString()}L.`,
  },

  /** data: allocationCode, truckNumber, customerName, deliveryId */
  "delivery.confirmed": {
    audience: "customer",
    category: "delivery",
    priority: "normal",
    channels: APP_ONLY,
    title: (d) => `Delivery ${d.allocationCode || ""} confirmed`.trim(),
    body: (d) => `Your delivery has been confirmed${d.truckNumber ? ` on truck ${d.truckNumber}` : ""}.`,
    entity: (d) => ({ type: "delivery", id: d.deliveryId || d.allocationCode }),
    data: (d) => ({ screen: "DeliveryDetail", allocationCode: d.allocationCode }),
    dedupe: (d) => (d.allocationCode ? `delivery.confirmed:${d.allocationCode}` : null),
  },

  /** data: allocationCode, customerName, reason, deliveryId */
  "delivery.rejected": {
    audience: "customer",
    category: "delivery",
    priority: "high",
    channels: APP_ONLY,
    title: (d) => `Delivery ${d.allocationCode || ""} rejected`.trim(),
    body: (d) => `This delivery was rejected.${d.reason ? ` Reason: ${d.reason}` : ""}`,
    entity: (d) => ({ type: "delivery", id: d.deliveryId || d.allocationCode }),
    data: (d) => ({ screen: "DeliveryDetail", allocationCode: d.allocationCode }),
    dedupe: (d) => (d.allocationCode ? `delivery.rejected:${d.allocationCode}` : null),
  },

  // ═══ Account & security (both realms) ═════════════════════════════════════

  /** data: customerName, licenseId, licenseType, reason */
  "license.approved": {
    audience: "customer",
    category: "account",
    priority: "normal",
    channels: APP_AND_EMAIL,
    title: () => "Licence approved",
    body: (d) => `Your ${d.licenseType || "licence"} has been verified and approved.`,
    entity: (d) => ({ type: "customer_license", id: d.licenseId }),
    data: (d) => ({ screen: "Licenses", licenseId: d.licenseId }),
    actionUrl: () => portalLink("/licenses"),
    dedupe: (d) => (d.licenseId ? `license.approved:${d.licenseId}` : null),
    email: (d) =>
      simpleEmail({
        subtitle: "Licence Verification",
        heading: "Your licence has been approved",
        intro: `${greet(d.customerName)}we've verified your ${d.licenseType || "licence"}. No further action is needed.`,
        cta: { url: portalLink("/licenses"), label: "View Licences" },
      }),
  },

  /** data: customerName, licenseId, licenseType, reason */
  "license.rejected": {
    audience: "customer",
    category: "account",
    priority: "high",
    channels: APP_AND_EMAIL,
    title: () => "Licence needs attention",
    body: (d) =>
      `Your ${d.licenseType || "licence"} could not be verified.` +
      `${d.reason ? ` Reason: ${d.reason}` : " Please upload a clearer copy."}`,
    entity: (d) => ({ type: "customer_license", id: d.licenseId }),
    data: (d) => ({ screen: "Licenses", licenseId: d.licenseId }),
    actionUrl: () => portalLink("/licenses"),
    dedupe: (d) => (d.licenseId ? `license.rejected:${d.licenseId}` : null),
    email: (d) =>
      simpleEmail({
        subtitle: "Licence Verification",
        heading: "Your licence could not be verified",
        intro: `${greet(d.customerName)}we were unable to verify your ${d.licenseType || "licence"}.`,
        note: d.reason || "Please upload a clearer copy from your account.",
        tone: "warning",
        cta: { url: portalLink("/licenses"), label: "Upload Again" },
      }),
  },

  /** data: customerName, status */
  "account.activated": {
    audience: "customer",
    category: "account",
    priority: "high",
    channels: APP_AND_EMAIL,
    title: () => "Your account is active",
    body: () => "You can now place orders on Soroman.",
    entity: (d) => ({ type: "customer", id: d.customerId }),
    data: () => ({ screen: "Home" }),
    actionUrl: () => portalLink("/"),
    dedupe: (d) => (d.customerId ? `account.activated:${d.customerId}` : null),
    email: (d) =>
      simpleEmail({
        subtitle: "Account Activated",
        heading: "Welcome to Soroman",
        intro: `${greet(d.customerName)}your account is active and you can now place orders.`,
        cta: { url: portalLink("/"), label: "Start Ordering" },
      }),
  },

  /**
   * Security notices are never suppressible — `mandatory` removes them from
   * the preference matrix entirely. Someone who muted "security" and then had
   * their account taken over would have muted the only warning they'd get.
   * data: provider, deviceName, ipAddress, at, principalName
   */
  "security.new_login": {
    audience: "both",
    category: "security",
    priority: "urgent",
    mandatory: true,
    channels: APP_ONLY,
    title: () => "New sign-in to your account",
    body: (d) =>
      `A new sign-in${d.provider ? ` via ${d.provider}` : ""}` +
      `${d.deviceName ? ` from ${d.deviceName}` : ""}` +
      `${d.at ? ` on ${formatDate(d.at, { withTime: true })}` : ""}. ` +
      `If this wasn't you, change your password immediately.`,
    entity: (d) => ({ type: "session", id: d.sessionId || "" }),
    data: (d) => ({ screen: "Security", provider: d.provider }),
    dedupe: (d) => (d.sessionId ? `security.new_login:${d.sessionId}` : null),
  },

  /** data: provider, principalName */
  "security.identity_linked": {
    audience: "both",
    category: "security",
    priority: "high",
    mandatory: true,
    channels: APP_ONLY,
    title: (d) => `${d.provider || "A sign-in method"} linked`,
    body: (d) =>
      `${d.provider || "A new sign-in method"} was linked to your account. ` +
      `If this wasn't you, contact Soroman immediately.`,
    entity: (d) => ({ type: "customer_identity", id: d.identityId || "" }),
    data: (d) => ({ screen: "Security", provider: d.provider }),
  },

  /** data: provider, principalName */
  "security.identity_unlinked": {
    audience: "both",
    category: "security",
    priority: "high",
    mandatory: true,
    channels: APP_ONLY,
    title: (d) => `${d.provider || "A sign-in method"} removed`,
    body: (d) =>
      `${d.provider || "A sign-in method"} was removed from your account. ` +
      `If this wasn't you, contact Soroman immediately.`,
    entity: (d) => ({ type: "customer_identity", id: d.identityId || "" }),
    data: (d) => ({ screen: "Security", provider: d.provider }),
  },

  /** data: principalName, at — password/PIN change confirmation */
  "security.credential_changed": {
    audience: "both",
    category: "security",
    priority: "urgent",
    mandatory: true,
    channels: APP_ONLY,
    title: (d) => `Your ${d.credential || "password"} was changed`,
    body: (d) =>
      `Your ${d.credential || "password"} was changed${d.at ? ` on ${formatDate(d.at, { withTime: true })}` : ""}. ` +
      `All other sessions have been signed out. If this wasn't you, contact Soroman immediately.`,
    entity: (d) => ({ type: "credential", id: d.credential || "password" }),
    data: () => ({ screen: "Security" }),
  },

  // ═══ Staff: operations ════════════════════════════════════════════════════

  /** data: orderId, reference, customerName, totalAmount, depotName, product, quantity, unit */
  "staff.order_placed": {
    audience: "staff",
    category: "operations",
    priority: "normal",
    channels: APP_ONLY,
    title: (d) => `New order ${ref(d)}`,
    body: (d) =>
      `${d.customerName || "A customer"} ordered ${formatQuantity(d.quantity, d.unit)}` +
      `${d.product ? ` of ${d.product}` : ""}` +
      `${d.totalAmount ? ` — ${formatMoney(d.totalAmount, { decimals: 0 })}` : ""}` +
      `${d.depotName ? ` at ${d.depotName}` : ""}.`,
    entity: (d) => ({ type: "order", id: d.orderId }),
    data: (d) => ({ screen: "OrderDetail", orderId: d.orderId }),
    actionUrl: (d) => adminLink(`/orders/${d.orderId}`),
    dedupe: (d) => (d.orderId ? `staff.order_placed:${d.orderId}` : null),
  },

  /** data: orderId, reference, customerName, amountPaid */
  "staff.payment_received": {
    audience: "staff",
    category: "payments",
    priority: "high",
    channels: APP_ONLY,
    title: (d) => `Payment received — ${ref(d)}`,
    body: (d) =>
      `${d.customerName || "A customer"} paid ${formatMoney(d.amountPaid, { decimals: 0 })}. ` +
      `The order is ready to release.`,
    entity: (d) => ({ type: "order", id: d.orderId }),
    data: (d) => ({ screen: "OrderDetail", orderId: d.orderId }),
    actionUrl: (d) => adminLink(`/orders/${d.orderId}`),
    dedupe: (d) => (d.orderId ? `staff.payment_received:${d.orderId}` : null),
  },

  /** data: requestId, requestNumber, kind ("Dangote"|"LPG"), customerName, quantity, quantityUnit */
  "staff.request_submitted": {
    audience: "staff",
    category: "operations",
    priority: "normal",
    channels: APP_ONLY,
    title: (d) => `New ${d.kind || ""} request ${d.requestNumber}`.replace(/\s+/g, " ").trim(),
    body: (d) =>
      `${d.customerName || "A customer"} submitted a request awaiting pricing and approval.`,
    entity: (d) => ({ type: d.entityType || "request", id: d.requestId }),
    data: (d) => ({ screen: d.screen || "Requests", requestId: d.requestId }),
    actionUrl: (d) => adminLink(d.adminPath || `/requests/${d.requestId}`),
    dedupe: (d) => (d.requestId && d.kind ? `staff.request_submitted:${d.kind}:${d.requestId}` : null),
  },

  /** data: reportId, location, reportDate, submitterName */
  "staff.daily_report_submitted": {
    audience: "staff",
    category: "reports",
    priority: "normal",
    channels: APP_ONLY,
    title: (d) => `Daily report — ${d.location || "site"}`,
    body: (d) =>
      `${d.submitterName || "A staff member"} submitted the report for ${d.reportDate || "today"}. ` +
      `It's awaiting review.`,
    entity: (d) => ({ type: "daily_report", id: d.reportId }),
    data: (d) => ({ screen: "DailyReportDetail", reportId: d.reportId }),
    actionUrl: (d) => adminLink(`/daily-reports/${d.reportId}`),
    dedupe: (d) => (d.reportId ? `staff.daily_report_submitted:${d.reportId}` : null),
  },

  /** data: reportId, location, reportDate — to the SUBMITTER */
  "staff.daily_report_approved": {
    audience: "staff",
    category: "reports",
    priority: "normal",
    channels: APP_AND_SMS,
    title: (d) => `Report approved — ${d.location || "site"}`,
    body: (d) => `Your daily report for ${d.reportDate || "the period"} was approved.`,
    entity: (d) => ({ type: "daily_report", id: d.reportId }),
    data: (d) => ({ screen: "DailyReportDetail", reportId: d.reportId }),
    actionUrl: (d) => adminLink(`/daily-reports/${d.reportId}`),
    dedupe: (d) => (d.reportId ? `staff.daily_report_approved:${d.reportId}` : null),
    // Wording preserved from the previous notification.service.js listener.
    sms: (d) =>
      `Soroman: your daily report for ${d.location || ""} (${d.reportDate || ""}) was approved.`,
  },

  /** data: reportId, location, reportDate, comment — to the SUBMITTER */
  "staff.daily_report_rejected": {
    audience: "staff",
    category: "reports",
    priority: "high",
    channels: APP_AND_SMS,
    title: (d) => `Report rejected — ${d.location || "site"}`,
    body: (d) =>
      `Your daily report for ${d.reportDate || "the period"} was rejected.` +
      `${d.comment ? ` Reason: ${d.comment}` : ""}`,
    entity: (d) => ({ type: "daily_report", id: d.reportId }),
    data: (d) => ({ screen: "DailyReportDetail", reportId: d.reportId }),
    actionUrl: (d) => adminLink(`/daily-reports/${d.reportId}`),
    dedupe: (d) => (d.reportId ? `staff.daily_report_rejected:${d.reportId}` : null),
    sms: (d) =>
      `Soroman: your daily report for ${d.location || ""} (${d.reportDate || ""}) was rejected.` +
      `${d.comment ? ` Reason: ${d.comment}` : ""}`,
  },

  /** data: incidentId, incidentType, severity, location, submitterName, summary */
  "staff.incident_submitted": {
    audience: "staff",
    category: "operations",
    // Incidents are the one operational event worth waking someone for.
    priority: "urgent",
    channels: APP_ONLY,
    title: (d) => `${d.incidentType || "Incident"} reported${d.location ? ` — ${d.location}` : ""}`,
    body: (d) =>
      `${d.submitterName || "A staff member"} logged ${d.incidentType || "an incident"}.` +
      `${d.summary ? ` ${d.summary}` : ""}`,
    entity: (d) => ({ type: "incident", id: d.incidentId }),
    data: (d) => ({ screen: "IncidentDetail", incidentId: d.incidentId }),
    actionUrl: (d) => adminLink(`/incidents/${d.incidentId}`),
    dedupe: (d) => (d.incidentId ? `staff.incident_submitted:${d.incidentId}` : null),
  },

  /** data: incidentId, status, incidentType, reviewerName — to the SUBMITTER */
  "staff.incident_updated": {
    audience: "staff",
    category: "operations",
    priority: "normal",
    channels: APP_ONLY,
    title: (d) => `Incident ${d.status || "updated"}`,
    body: (d) =>
      `Your ${d.incidentType || "incident"} report was marked ${d.status || "updated"}` +
      `${d.reviewerName ? ` by ${d.reviewerName}` : ""}.`,
    entity: (d) => ({ type: "incident", id: d.incidentId }),
    data: (d) => ({ screen: "IncidentDetail", incidentId: d.incidentId }),
    actionUrl: (d) => adminLink(`/incidents/${d.incidentId}`),
    dedupe: (d) => (d.incidentId && d.status ? `staff.incident_updated:${d.incidentId}:${d.status}` : null),
  },

  /** data: saleId, reference, status, amount, submitterName */
  "staff.offline_sale_updated": {
    audience: "staff",
    category: "operations",
    priority: "normal",
    channels: APP_ONLY,
    title: (d) => `Offline sale ${d.status || "updated"}`,
    body: (d) =>
      `Sale ${d.reference || `#${d.saleId}`}` +
      `${d.amount ? ` (${formatMoney(d.amount, { decimals: 0 })})` : ""} was ${d.status || "updated"}.`,
    entity: (d) => ({ type: "offline_sale", id: d.saleId }),
    data: (d) => ({ screen: "OfflineSaleDetail", saleId: d.saleId }),
    actionUrl: (d) => adminLink(`/offline-sales/${d.saleId}`),
    dedupe: (d) => (d.saleId && d.status ? `staff.offline_sale_updated:${d.saleId}:${d.status}` : null),
  },

  /** data: truckNumber, truckId, action, actorName */
  "staff.fleet_updated": {
    audience: "staff",
    category: "operations",
    priority: "low",
    channels: [CHANNELS.IN_APP], // ambient; never worth a buzz
    title: (d) => `Truck ${d.truckNumber || ""} ${d.action || "updated"}`.replace(/\s+/g, " ").trim(),
    body: (d) => `${d.actorName || "Someone"} ${d.action || "updated"} truck ${d.truckNumber || ""}.`.trim(),
    entity: (d) => ({ type: "fleet_truck", id: d.truckId }),
    data: (d) => ({ screen: "TruckDetail", truckId: d.truckId }),
    actionUrl: (d) => adminLink(`/fleet/${d.truckId}`),
  },

  /** data: licenseId, customerName, licenseType */
  "staff.license_pending": {
    audience: "staff",
    category: "operations",
    priority: "normal",
    channels: APP_ONLY,
    title: () => "Licence awaiting verification",
    body: (d) =>
      `${d.customerName || "A customer"} uploaded a ${d.licenseType || "licence"} for verification.`,
    entity: (d) => ({ type: "customer_license", id: d.licenseId }),
    data: (d) => ({ screen: "LicenseDetail", licenseId: d.licenseId }),
    actionUrl: (d) => adminLink(`/customer-licenses/${d.licenseId}`),
    dedupe: (d) => (d.licenseId ? `staff.license_pending:${d.licenseId}` : null),
  },

  // ═══ Transactional email only (no inbox row) ══════════════════════════════

  /**
   * `inbox: false` — these are credentials in transit, not something to
   * re-read later. An inbox row would be noise at best; at worst it would
   * surface a reset link inside an account that may already be compromised.
   * data: email, token, firstName
   */
  "account.password_setup": {
    audience: "staff",
    category: "security",
    priority: "urgent",
    mandatory: true,
    inbox: false,
    channels: EMAIL_ONLY,
    title: () => "Set your password",
    body: () => "An account has been created for you on the Soroman Dashboard.",
    email: (d) =>
      simpleEmail({
        subtitle: "Account Setup",
        heading: `Welcome, ${firstName(d.firstName) || "there"}!`,
        intro:
          "An account has been created for you on the Soroman Dashboard. " +
          "To get started, please set your password using the button below.",
        cta: { url: d.setPasswordUrl, label: "Set Your Password" },
        note: "This link will expire in 24 hours. If you did not expect this email, please ignore it.",
        tone: "warning",
      }),
  },

  /** data: email, token, firstName, resetUrl */
  "account.password_reset": {
    audience: "staff",
    category: "security",
    priority: "urgent",
    mandatory: true,
    inbox: false,
    channels: EMAIL_ONLY,
    title: () => "Reset your password",
    body: () => "We received a request to reset your password.",
    email: (d) =>
      simpleEmail({
        subtitle: "Password Reset",
        heading: `Hello, ${firstName(d.firstName) || "there"}!`,
        intro:
          "We received a request to reset your password. " +
          "Click the button below to set a new one.",
        cta: { url: d.resetUrl, label: "Reset Your Password" },
        note:
          "This link will expire in 1 hour. If you did not request a password reset, " +
          "please ignore this email — your password will remain unchanged.",
        tone: "warning",
      }),
  },

  // ═══ System ═══════════════════════════════════════════════════════════════

  /**
   * The admin broadcast. Copy comes from the sender rather than from here,
   * which is exactly why it is the only entry whose title/body are pass-through.
   * data: title, body, actionUrl, imageUrl
   */
  "system.announcement": {
    audience: "both",
    category: "system",
    priority: "normal",
    channels: APP_ONLY,
    title: (d) => d.title || "Announcement",
    body: (d) => d.body || "",
    entity: (d) => ({ type: "announcement", id: d.announcementId || "" }),
    data: (d) => ({ screen: "Announcement", ...(d.link ? { link: d.link } : {}) }),
    actionUrl: (d) => d.actionUrl || null,
    imageUrl: (d) => d.imageUrl || null,
  },
};

// ─── Accessors ──────────────────────────────────────────────────────────────

/**
 * The fallback for an unknown type.
 *
 * A typo in a `notify()` call must not silently drop the notification — the
 * recipient still gets something readable and the delivery row still names the
 * type, so the mistake is visible in the log rather than invisible in a
 * swallowed exception.
 */
const UNKNOWN = {
  audience: "both",
  category: "system",
  priority: "normal",
  channels: [CHANNELS.IN_APP],
  title: (d) => d.title || "Notification",
  body: (d) => d.body || "",
};

const getType = (type) => CATALOG[type] || null;
const getTypeOrDefault = (type) => CATALOG[type] || UNKNOWN;
const isKnownType = (type) => Object.prototype.hasOwnProperty.call(CATALOG, type);
const listTypes = () => Object.keys(CATALOG);

/** The categories a given audience can actually receive — powers the settings UI. */
const categoriesFor = (audience) => {
  const set = new Set();
  for (const entry of Object.values(CATALOG)) {
    if (entry.mandatory) continue; // not user-controllable, so not shown
    if (entry.audience === audience || entry.audience === "both") set.add(entry.category);
  }
  return [...set].sort();
};

/** Default channel toggles per category, for rendering an untouched settings screen. */
const defaultPreferencesFor = (audience) => {
  const byCategory = {};
  for (const entry of Object.values(CATALOG)) {
    if (entry.mandatory) continue;
    if (entry.audience !== audience && entry.audience !== "both") continue;
    const current = (byCategory[entry.category] ||= {
      inApp: false,
      push: false,
      email: false,
      sms: false,
    });
    // A category offers a channel if ANY of its types uses it.
    for (const channel of entry.channels || []) {
      if (channel === CHANNELS.IN_APP) current.inApp = true;
      if (channel === CHANNELS.PUSH) current.push = true;
      if (channel === CHANNELS.EMAIL) current.email = true;
      if (channel === CHANNELS.SMS) current.sms = true;
    }
  }
  return byCategory;
};

module.exports = {
  CATALOG,
  CHANNELS,
  UNKNOWN,
  getType,
  getTypeOrDefault,
  isKnownType,
  listTypes,
  categoriesFor,
  defaultPreferencesFor,
  // Exported for the engine's renderers and for tests.
  helpers: { greet, firstName, ref, simpleEmail, adminLink, portalLink },
};
