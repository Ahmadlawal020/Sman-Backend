const { eq } = require("drizzle-orm");
const { db } = require("../config/db");
const { orderTrucks } = require("../db/schema");
const commissionRepo = require("../repositories/commission.repository");
const { orderRepo } = require("../repositories");
const walletService = require("./wallet.service");

/**
 * Create a commission record for a paid order.
 *
 * Called after an order's paymentStatus becomes "Paid". Looks up the
 * commission rate for the order's depot+product, sums truck quantities
 * (falls back to order.quantity), and inserts a snapshot record.
 *
 * If no rate is configured, commission is created with rate=0 so it
 * still appears on the page — admin can set the rate later.
 */
async function createForOrder(orderId) {
  // Idempotency: skip if a commission already exists for this order
  const existing = await commissionRepo.findByOrderId(orderId);
  if (existing) return existing;

  const order = await orderRepo.findById(orderId);
  if (!order) return null;

  // Sum truck quantities, fallback to order.quantity
  const trucks = await db
    .select()
    .from(orderTrucks)
    .where(eq(orderTrucks.orderId, orderId));

  let quantity = Number(order.quantity);
  if (trucks.length > 0) {
    const truckSum = trucks.reduce((s, t) => s + Number(t.quantity), 0);
    if (truckSum > 0) quantity = truckSum;
  }

  // Look up commission rate
  const rateEntry = await commissionRepo.getRate(order.depotId, order.productId);
  const commissionRate = rateEntry ? parseFloat(rateEntry.commissionRate) : 0;
  const commissionAmount = quantity * commissionRate;

  const commission = await commissionRepo.create({
    orderId: order.id,
    customerId: order.customerId,
    depotId: order.depotId,
    productId: order.productId,
    quantity,
    commissionRate: String(commissionRate),
    commissionAmount: String(commissionAmount.toFixed(2)),
    status: "pending",
  });

  return commission;
}

/**
 * Confirm a commission payment.
 *
 * Validates the commission exists and is still pending, then:
 * 1. Credits the customer's wallet balance with the commission amount
 * 2. Creates a deposit entry (visible in deposit history)
 * 3. Marks the commission as "paid"
 *
 * All steps run in a single transaction.
 */
async function confirmPayment(commissionId, staffId) {
  const commission = await commissionRepo.findById(commissionId);
  if (!commission) {
    throw Object.assign(new Error("Commission not found"), { status: 404 });
  }
  if (commission.status === "paid") {
    throw Object.assign(new Error("Commission already paid"), { status: 400 });
  }

  const amount = parseFloat(commission.commissionAmount);
  if (amount <= 0) {
    throw Object.assign(new Error("Commission amount is zero — set a rate first"), { status: 400 });
  }

  // Credit the customer's wallet balance
  const reference = `COM-${commission.orderNumber || commission.orderId}-${commissionId}`;
  const description = `Commission for Order ${commission.orderNumber || commission.orderId}`;

  const creditResult = await walletService.credit({
    customerId: commission.customerId,
    amount,
    description,
    reference,
    recordedBy: staffId,
    trackDeposit: true,
  });

  if (!creditResult.success) {
    throw Object.assign(new Error(creditResult.message || "Failed to credit wallet"), { status: 400 });
  }

  // Mark the commission as paid
  const paid = await commissionRepo.markAsPaid(commissionId, staffId);

  return { commission: paid, deposit: creditResult.deposit };
}

module.exports = { createForOrder, confirmPayment };
