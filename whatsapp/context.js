const { eq, desc } = require("drizzle-orm");
const { db } = require("../config/db");
const { orders } = require("../db/schema");
const { orderRepo, waMessageRepo } = require("../repositories");
const { loadCatalog } = require("../services/catalog.service");

/**
 * Builds the `context` the pure engine consumes. The engine never fetches —
 * everything it may need is loaded here, before reduce() runs.
 *
 * The catalog itself lives in services/catalog.service — shared with the
 * portal so every channel agrees on what is orderable. Its filtering rule is
 * what the engine's design leans on: a depot with no priced, in-stock product
 * simply IS NOT in context.depots. The customer can never pick something that
 * would fail three steps later; validity is a filtering problem at load time,
 * not an error-handling problem at confirm time.
 */

const SERVICE_WINDOW_HOURS = 24;

/** The customer's most recent order, shaped for track/reorder. */
const loadLastOrder = async (customerId, lastOrderId) => {
  let orderId = lastOrderId;
  if (!orderId && customerId) {
    const [latest] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.customerId, customerId))
      .orderBy(desc(orders.createdAt))
      .limit(1);
    orderId = latest?.id;
  }
  if (!orderId) return undefined;

  const full = await orderRepo.findByIdFull(orderId);
  if (!full) return undefined;
  return {
    id: full.id,
    orderNumber: full.orderNumber,
    status: full.status,
    depotId: full.depotId,
    productId: full.productId,
    quantity: full.quantity,
    deliveryType: full.deliveryType,
    productName: full.productName || "product",
    depotName: full.depotName || "depot",
    totalAmount: full.totalAmount,
    // For "Finish payment" on an unpaid last order.
    virtualAccountBank: full.virtualAccountBank,
    virtualAccountNumber: full.virtualAccountNumber,
  };
};

/**
 * Everything reduce() needs for one turn. `withinServiceWindow` is computed
 * from the newest inbound message — while answering an inbound it is true by
 * definition, but system re-entries (a payment confirmed hours later) pass
 * through here too, and those are the sends the window actually constrains.
 */
const loadContext = async ({ waPhone, customer, session }) => {
  const [catalog, lastOrder, lastInbound] = await Promise.all([
    loadCatalog(),
    loadLastOrder(customer?.id, session?.lastOrderId),
    waMessageRepo.lastInboundAt(waPhone),
  ]);

  const withinServiceWindow = Boolean(
    lastInbound && Date.now() - new Date(lastInbound).getTime() < SERVICE_WINDOW_HOURS * 60 * 60 * 1000
  );

  return {
    customer: customer || null,
    depots: catalog,
    lastOrder,
    withinServiceWindow,
    supportPhone: process.env.SUPPORT_PHONE || "our support line",
    portalUrl: process.env.CLIENT_URL || "",
    // Test environments get an "I've paid" button that simulates the
    // transfer — never in production, never on a live Paystack key.
    devSimulatePayment:
      process.env.NODE_ENV !== "production" &&
      (process.env.PAYSTACK_SECRET_KEY || "").startsWith("sk_test"),
  };
};

module.exports = { loadContext, loadCatalog, loadLastOrder, SERVICE_WINDOW_HOURS };
