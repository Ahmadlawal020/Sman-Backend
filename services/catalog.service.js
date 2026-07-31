const { sql, eq, gt, and } = require("drizzle-orm");
const { db } = require("../config/db");
const { depots, products, depotProductPrices, pfis } = require("../db/schema");

/**
 * The single definition of "orderable" — shared by every sales channel.
 *
 * The WhatsApp engine and the portal must never disagree about what can be
 * bought where and at what price, so both load through here. The filtering
 * rule channels lean on: a depot with no priced, in-stock product simply is
 * not in the catalog. Validity is a filtering problem at load time, not an
 * error-handling problem at confirm time.
 */

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
        category: products.category,
      })
      .from(depotProductPrices)
      .innerJoin(products, eq(products.id, depotProductPrices.productId))
      // Dangote delivery SKUs never carry depot prices, but the depot catalog
      // is depot-sourced by definition — keep the type filter explicit.
      .where(and(gt(depotProductPrices.currentPrice, "0"), eq(products.productType, "soroman"))),
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
          // The short trade code (PMS, AGO, ...) the portal shows as the
          // product's badge; the category enum doubles as it.
          category: p.category,
          unit: p.unit || "Liters",
          price: Number(p.price),
          stock: stockByKey.get(`${p.depotId}:${p.productId}`) || 0,
        }))
        .filter((p) => p.stock > 0),
    }))
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

module.exports = { loadCatalog, publicCatalog };
