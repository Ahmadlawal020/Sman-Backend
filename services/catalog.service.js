const { sql, eq, gt } = require("drizzle-orm");
const { db } = require("../config/db");
const { consumerDepots, consumerStates, consumerProduct, consumerProductprice, consumerPfi, consumerPfimovement } = require("../db/schema");

/**
 * The short trade code a product is known by on the floor — PMS, AGO, LPG.
 *
 * `sku` doesn't exist on consumer_product at all — the closest live column
 * is `abbreviation`. See order.repository.js's header comment for the wider
 * pattern of what got renamed/dropped in the cutover.
 */
const tradeCode = (product) => {
  const sku = String(product?.abbreviation || "").trim();
  if (sku) return sku.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

  return String(product?.name || "")
    .split(/\s+/)
    .map((w) => w[0] || "")
    .join("")
    .toUpperCase()
    .slice(0, 4);
};

/**
 * The single definition of "orderable" — shared by every sales channel.
 *
 * consumer_depots has no state FK (just a free-text location string), and
 * pricing/stock are both state-scoped live, not depot-scoped (see
 * repositories/depot.repository.js and pfi.repository.js) — every depot in
 * the same state now shows identical price/stock, which is the live data
 * model's reality, not a display choice made here.
 *
 * Stock is computed from the PFI ledger (starting - SUM(consumer_pfimovement)),
 * the same pool placeOrder reserves from — not consumer_productprice's own
 * stock_quantity column, which is a separate Django-native counter. Using
 * the PFI ledger keeps the catalog and order placement from disagreeing
 * about whether something is actually available.
 */

/** All orderable depots, each with its priced + in-stock products. */
const loadCatalog = async () => {
  const [depotRows, stateRows, priceRows, stockRows] = await Promise.all([
    db.select({ id: consumerDepots.id, name: consumerDepots.name, location: consumerDepots.location }).from(consumerDepots),
    db.select({ id: consumerStates.id, name: consumerStates.name }).from(consumerStates),
    db
      .select({
        stateId: consumerProductprice.stateId,
        productId: consumerProductprice.productId,
        price: consumerProductprice.price,
        name: consumerProduct.name,
        unit: consumerProduct.unit,
        abbreviation: consumerProduct.abbreviation,
      })
      .from(consumerProductprice)
      .innerJoin(consumerProduct, eq(consumerProduct.id, consumerProductprice.productId))
      .where(gt(consumerProductprice.price, "0")),
    // Sellable stock = active PFIs' remaining litres, per state × product —
    // the same pool placeOrder reserves from.
    db
      .select({
        stateId: consumerPfi.locationId,
        productId: consumerPfi.productId,
        stock: sql`SUM(${consumerPfi.startingQtyLitres}::numeric - COALESCE((
          SELECT SUM(${consumerPfimovement.qtyLitres}::numeric) FROM ${consumerPfimovement}
          WHERE ${consumerPfimovement.pfiId} = ${consumerPfi.id}
        ), 0))`.mapWith(Number),
      })
      .from(consumerPfi)
      .where(eq(consumerPfi.status, "active"))
      .groupBy(consumerPfi.locationId, consumerPfi.productId),
  ]);

  const stateIdByName = new Map(stateRows.map((s) => [s.name, s.id]));
  const stockByKey = new Map(stockRows.map((r) => [`${r.stateId}:${r.productId}`, r.stock]));
  const pricesByState = new Map();
  for (const p of priceRows) {
    if (!pricesByState.has(p.stateId)) pricesByState.set(p.stateId, []);
    pricesByState.get(p.stateId).push(p);
  }

  return depotRows
    .map((depot) => {
      const stateId = stateIdByName.get(depot.location);
      const statePrices = stateId ? pricesByState.get(stateId) || [] : [];
      return {
        id: depot.id,
        name: depot.name,
        state: depot.location,
        products: statePrices
          .map((p) => ({
            id: p.productId,
            name: p.name,
            sku: p.abbreviation || "",
            // The badge every sales channel shows beside the name: PMS, AGO, LPG.
            code: tradeCode(p),
            // Legacy alias. Clients read `category` for the badge today, from when
            // the category column held the trade code, so it keeps carrying the
            // code rather than "Fuel" — that way this fix needs no coordinated
            // client release. New code should read `code`; this can go once the
            // shipped mobile builds have aged out.
            category: tradeCode(p),
            unit: p.unit || "Liters",
            price: Number(p.price),
            stock: stateId ? stockByKey.get(`${stateId}:${p.productId}`) || 0 : 0,
          }))
          .filter((p) => p.stock > 0),
      };
    })
    .filter((depot) => depot.products.length > 0);
};

/**
 * The catalog as the public may see it: names, states, and prices — never
 * litres. Stock levels are commercial information (the WhatsApp copy refuses
 * to reveal them even when a quantity is over stock), so the internal `stock`
 * field stops here. Being listed at all already means "in stock"; an exact
 * number would tell competitors how much we hold.
 */
const publicCatalog = async () => {
  const catalog = await loadCatalog();
  return catalog.map((depot) => ({
    ...depot,
    products: depot.products.map(({ stock, ...product }) => product),
  }));
};

module.exports = { loadCatalog, publicCatalog, tradeCode };
