const asyncHandler = require("express-async-handler");
const { orderRepo } = require("../../repositories");
const { placeOrder } = require("../../services/order.service");

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
  const { state, depot: depotId, product: productId, quantity, deliveryType, trucks } = req.body;

  const { order, payment } = await placeOrder({
    customerId: req.customer.id,
    state,
    depotId,
    productId,
    quantity,
    deliveryType,
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

module.exports = { createMyOrder, listMyOrders, getMyOrder };
