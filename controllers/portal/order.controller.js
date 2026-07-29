const asyncHandler = require("express-async-handler");
const { orderRepo } = require("../../repositories");
const { placeOrder } = require("../../services/order.service");
const walletService = require("../../services/wallet.service");
const { processUnpaidOrdersForCustomer } = require("../../services/payment.service");

// Test-mode gate, identical to the WhatsApp DEV_SIMULATE_PAYMENT effect
// (whatsapp/pipeline.js): only ever true against a non-production server wired
// to a Paystack TEST key. A production deploy can never satisfy it, so the
// route below is inert there no matter what the client sends.
const isDevPaymentAllowed = () =>
  process.env.NODE_ENV !== "production" &&
  (process.env.PAYSTACK_SECRET_KEY || "").startsWith("sk_test");

/**
 * POST /api/customer/orders — the signed-in customer places their OWN order.
 *
 * The customer id comes from the token (req.customer), never the body: a
 * customer can only order for themselves. The heavy lifting — pricing, stock,
 * the atomic transaction, the wallet-pays Paid transition, notifications — is
 * the shared placeOrder service, the same one the desk uses. If the wallet
 * can't cover it the order is created Unpaid and the response carries the
 * virtual account to pay into; the Paystack webhook then advances it to Paid.
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

/** GET /api/customer/orders — the customer's own orders, newest first. */
const listMyOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const result = await orderRepo.findAll({ customer: req.customer.id, page, limit });
  res.json({ success: true, data: result });
});

/**
 * GET /api/customer/orders/:id — one of the customer's own orders, scoped by
 * ownership. Another customer's order reads as 404 — it never confirms the row
 * exists, let alone leaks it.
 */
const getMyOrder = asyncHandler(async (req, res) => {
  const order = await orderRepo.findByIdFull(req.params.id);
  if (!order || order.customerId !== req.customer.id) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }
  res.json({ success: true, data: { order } });
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

module.exports = { createMyOrder, listMyOrders, getMyOrder, simulateMyPayment };
