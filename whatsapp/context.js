const { sql, eq, gt, and, desc } = require("drizzle-orm");
const { db } = require("../config/db");
const { depots, products, depotProductPrices, pfis, orders } = require("../db/schema");
const { orderRepo, waMessageRepo } = require("../repositories");

/**
 * Builds the `context` the pure engine consumes. The engine never fetches —
 * everything it may need is loaded here, before reduce() runs.
 *
 * The filtering rule the engine's design leans on: a depot with no priced,
 * in-stock product simply IS NOT in context.depots. The customer can never
 * pick something that would fail three steps later; validity is a filtering
 * problem at load time, not an error-handling problem at confirm time.
 */

const SERVICE_WINDOW_HOURS = 24;

/** All orderable depots, each with its priced + in-stock products. */
const loadCatalog = async () => {
  const [depotRows, priceRows, stockRows] = await Promise.all([
    db.select({ id: depots.id, name: depots.name, state: depots.state }).from(depots),
    db
      .select({
        depotId: depotProductPrices.depotId,
        productId: depotProductPrices.productId,
        price: depotProductPrices.currentPrice,
        name: products.name,
        unit: products.unit,
      })
      .from(depotProductPrices)
      .innerJoin(products, eq(products.id, depotProductPrices.productId))
      .where(gt(depotProductPrices.currentPrice, "0")),
    // Sellable stock = active PFIs' remaining litres, per depot × product —
    // the same pool placeOrder reserves from.
    db
      .select({
        depotId: pfis.locationId,
        productId: pfis.productId,
        stock: sql`sum(${pfis.startingQtyLitres} - ${pfis.soldQtyLitres})`.mapWith(Number),
      })
      .from(pfis)
      .where(eq(pfis.status, "active"))
      .groupBy(pfis.locationId, pfis.productId),
  ]);

  const stockByKey = new Map(stockRows.map((r) => [`${r.depotId}:${r.productId}`, r.stock]));

  return depotRows
    .map((depot) => ({
      id: depot.id,
      name: depot.name,
      state: depot.state,
      products: priceRows
        .filter((p) => p.depotId === depot.id)
        .map((p) => ({
          id: p.productId,
          name: p.name,
          unit: p.unit || "Liters",
          price: Number(p.price),
          stock: stockByKey.get(`${p.depotId}:${p.productId}`) || 0,
        }))
        .filter((p) => p.stock > 0),
    }))
    .filter((depot) => depot.products.length > 0);
};

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
