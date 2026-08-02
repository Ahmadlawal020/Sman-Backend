const asyncHandler = require("express-async-handler");
const { orderRepo } = require("../../repositories");
const { placeOrder, updatePickupTrucks, payOrder } = require("../../services/order.service");
const walletService = require("../../services/wallet.service");
const { processUnpaidOrdersForCustomer } = require("../../services/payment.service");
const {
  buildReached,
  currentStage,
  stageNote,
} = require("../../services/tracking.service");

// Test-mode gate, identical to the WhatsApp DEV_SIMULATE_PAYMENT effect
// (whatsapp/pipeline.js): only ever true against a non-production server wired
// to a Paystack TEST key. A production deploy can never satisfy it, so the
// route below is inert there no matter what the client sends.
const isDevPaymentAllowed = () =>
  process.env.NODE_ENV !== "production" &&
  (process.env.PAYSTACK_SECRET_KEY || "").startsWith("sk_test");

// Per-truck movement in words, for the order owner's own detail view. Mirrors
// the public tracking labels (tracking.service.js) so the two surfaces read
// the same, but the owner's view additionally carries driver contact and gate
// stamps — details the public feed withholds.
const TRUCK_STATUS_LABEL = {
  pending: "Assigned",
  gated_in: "At the depot",
  loaded: "Loaded",
  gated_out: "Departed",
};

const toOwnerTruck = (t) => ({
  index: t.truckIndex,
  plate: t.truckNumber || null,
  quantity: Number(t.quantity),
  status: t.status,
  statusLabel: TRUCK_STATUS_LABEL[t.status] || t.status,
  driverName: t.driverName || null,
  driverPhone: t.driverPhone || null,
  enteredAt: t.securityEnteredAt || null,
  loadedAt: t.loadedAt || null,
  exitedAt: t.securityExitedAt || null,
});

/**
 * Enrich an order the owner is reading: truck loads, the stage timeline
 * (`reached` / `stage` / `note`), so the signed-in detail page can render
 * progress without a second hop to the public tracking endpoint. Cancelled
 * orders still carry `reached.cancelled` but leave `stage`/`note` null —
 * there is no public stage for a cancellation.
 */
const withOwnerDetail = async (order) => {
  const trucks = (await orderRepo.findTrucksByOrderId(order.id)).map(toOwnerTruck);
  order.trucks = trucks;
  order.reached = buildReached(order);
  if (order.status === "Cancelled") {
    order.stage = null;
    order.note = null;
  } else {
    order.stage = currentStage(order);
    order.note = stageNote(order.stage, { ...order, trucks });
  }
  return order;
};

/**
 * POST /api/customer/orders — the signed-in customer places their OWN order.
 *
 * The customer id comes from the token (req.customer), never the body: a
 * customer can only order for themselves. The heavy lifting — pricing, stock,
 * the atomic transaction, notifications — is the shared placeOrder service, the
 * same one the desk uses. Orders are always created Unpaid; the response carries
 * the virtual account to pay into. Payment then arrives one of three ways: a
 * bank transfer the Paystack webhook confirms, the customer paying from wallet
 * balance (POST /:id/pay), or staff settling it from finance.
 */
const createMyOrder = asyncHandler(async (req, res) => {
  const {
    state,
    depot: depotId,
    product: productId,
    quantity,
    deliveryType,
    deliveryAddress,
    trucks,
  } = req.body;

  const { order, payment } = await placeOrder({
    customerId: req.customer.id,
    state,
    depotId,
    productId,
    quantity,
    deliveryType,
    deliveryAddress,
    trucks,
    actor: { type: "customer", customerId: req.customer.id },
  });

  res.status(201).json({
    success: true,
    message:
      order.paymentStatus === "Paid"
        ? "Order placed and paid from your wallet balance."
        : "Order placed. Transfer the total to the account shown to have it released.",
    data: { order, payment },
  });
});

/**
 * GET /api/customer/orders — the customer's own orders, newest first.
 * Accepts the same filters as the admin list (search by order number, status,
 * date range) plus pagination; `customer` is always forced from the token, so
 * the filters can only ever narrow the caller's OWN history.
 */
const listMyOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, search, status, dateFrom, dateTo } = req.query;
  const result = await orderRepo.findAll({
    customer: req.customer.id,
    search,
    status,
    dateFrom,
    dateTo,
    page,
    limit,
  });
  res.json({ success: true, data: result });
});

/**
 * GET /api/customer/orders/:id — one of the customer's own orders, scoped by
 * ownership. Another customer's order reads as 404 — it never confirms the row
 * exists, let alone leaks it. Carries the lifecycle timestamps, the stage
 * timeline (`reached` / `stage` / `note`), and the order's truck loads, so the
 * owner sees the full timeline behind auth without the public tracking hop.
 */
const getMyOrder = asyncHandler(async (req, res) => {
  const order = await orderRepo.findByIdFull(req.params.id);
  if (!order || order.customerId !== req.customer.id) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }
  res.json({ success: true, data: { order: await withOwnerDetail(order) } });
});

/**
 * GET /api/customer/orders/by-ref/:ref — the same detail as :id, but keyed by
 * the order NUMBER (the reference the customer actually holds — on the invoice,
 * the SMS, the dashboard). Ownership-scoped identically: an unknown reference,
 * or one belonging to another customer, is a flat 404.
 */
const getMyOrderByRef = asyncHandler(async (req, res) => {
  const order = await orderRepo.findByNumberFull(req.params.ref);
  if (!order || order.customerId !== req.customer.id) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }
  res.json({ success: true, data: { order: await withOwnerDetail(order) } });
});

/**
 * POST /api/customer/orders/:id/simulate-payment — the web mirror of the
 * WhatsApp "I've paid ✅ (test)" button. For testers only: refuses outside test
 * mode (403), so the invoice-page button is dead against production.
 *
 * When allowed, it takes the exact production settlement path: credit the
 * wallet ledger for the order total (idempotent by reference), then run
 * processUnpaidOrdersForCustomer — which drives Pending→Paid through the state
 * machine, books the hold, generates the ticket, and enqueues the "payment
 * received" push. The tester's confirmation is the real one, not a fake flag.
 */
const simulateMyPayment = asyncHandler(async (req, res) => {
  if (!isDevPaymentAllowed()) {
    return res.status(403).json({
      success: false,
      message: "Simulated payment is only available in test mode.",
    });
  }

  const order = await orderRepo.findById(req.params.id);
  if (!order || order.customerId !== req.customer.id) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }

  // Idempotent: an order already paid (wallet at order time, a real transfer,
  // or a second click) needs no further work.
  if (order.paymentStatus === "Paid") {
    return res.json({ success: true, message: "Order is already paid." });
  }

  await walletService.credit({
    customerId: order.customerId,
    amount: Number(order.totalAmount),
    description: "Simulated bank transfer (dev button)",
    reference: `DEV-SIM-${order.id}`,
  });
  await processUnpaidOrdersForCustomer(order.customerId);

  res.json({ success: true, message: "Simulated payment applied." });
});

/**
 * POST /api/customer/orders/:id/pay — the customer settles their OWN unpaid
 * order from their wallet balance (the self-service "Pay from wallet" action).
 *
 * The shared payOrder service places the hold, drives Pending→Paid, and issues
 * the ticket + commission in one transaction. `customerId` scopes it to the
 * caller: a foreign order 404s under the row lock, never confirmed. An empty
 * balance is a 400, an already-paid or non-Pending order a 409 — all surfaced
 * from the service with the customer-facing message.
 */
const payMyOrder = asyncHandler(async (req, res) => {
  const order = await payOrder({
    orderId: Number(req.params.id),
    customerId: req.customer.id,
    actor: { type: "customer", customerId: req.customer.id },
  });

  res.json({
    success: true,
    message: `Order ${order.orderNumber} paid from your wallet balance.`,
    data: { order: await withOwnerDetail(order) },
  });
});

/**
 * PATCH /api/customer/orders/by-ref/:ref/trucks — replace the pickup truck
 * declaration on the caller's own order. Plate/driver may be blank (filled at
 * the gate); quantities must still sum to the order. Refuses once any load
 * has gated in, or if the order has moved past Released.
 */
const updateMyOrderTrucks = asyncHandler(async (req, res) => {
  const order = await orderRepo.findByNumberFull(req.params.ref);
  if (!order || order.customerId !== req.customer.id) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }

  await updatePickupTrucks({
    orderId: order.id,
    customerId: req.customer.id,
    trucks: req.body.trucks,
    actor: { type: "customer", customerId: req.customer.id },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  const fresh = await orderRepo.findByNumberFull(req.params.ref);
  res.json({
    success: true,
    message: "Truck details saved",
    data: { order: await withOwnerDetail(fresh) },
  });
});

module.exports = {
  createMyOrder,
  listMyOrders,
  getMyOrder,
  getMyOrderByRef,
  simulateMyPayment,
  payMyOrder,
  updateMyOrderTrucks,
};
