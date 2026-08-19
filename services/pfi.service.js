const { pfiRepo } = require("../repositories");

async function getAvailableCapacity(depotId, productId) {
  const activePfis = await pfiRepo.findActiveByDepotAndProduct(depotId, productId);

  return activePfis.reduce((total, pfi) => {
    const available = Math.max(
      0,
      (pfi.startingQtyLitres || 0) - (pfi.soldQtyLitres || 0)
    );
    return total + available;
  }, 0);
}

async function getDepotCapacities(depotId) {
  const { db } = require("../config/db");
  const { pfis } = require("../db/schema");
  const { eq, and } = require("drizzle-orm");

  const numericDepotId = parseInt(depotId, 10);
  if (isNaN(numericDepotId)) return {};

  const activePfis = await db
    .select({
      productId: pfis.productId,
      startingQtyLitres: pfis.startingQtyLitres,
      soldQtyLitres: pfis.soldQtyLitres,
    })
    .from(pfis)
    .where(and(eq(pfis.locationId, numericDepotId), eq(pfis.status, "active")));

  const capacityMap = {};
  for (const pfi of activePfis) {
    const prodKey = pfi.productId;
    if (!prodKey) continue;
    const available = Math.max(
      0,
      Number(pfi.startingQtyLitres || 0) - Number(pfi.soldQtyLitres || 0)
    );
    capacityMap[prodKey] = (capacityMap[prodKey] || 0) + available;
    capacityMap[String(prodKey)] = capacityMap[prodKey];
  }

  return capacityMap;
}

async function getMultiDepotCapacities(depotIds) {
  const { db } = require("../config/db");
  const { pfis } = require("../db/schema");
  const { eq, and, inArray } = require("drizzle-orm");

  const numericIds = (depotIds || []).map((id) => parseInt(id, 10)).filter((n) => !isNaN(n));
  if (numericIds.length === 0) return {};

  const activePfis = await db
    .select({
      locationId: pfis.locationId,
      productId: pfis.productId,
      startingQtyLitres: pfis.startingQtyLitres,
      soldQtyLitres: pfis.soldQtyLitres,
    })
    .from(pfis)
    .where(and(inArray(pfis.locationId, numericIds), eq(pfis.status, "active")));

  const pfiCapacityMap = {};
  for (const pfi of activePfis) {
    const depotKey = pfi.locationId;
    const prodKey = pfi.productId;
    if (!prodKey) continue;
    if (!pfiCapacityMap[depotKey]) pfiCapacityMap[depotKey] = {};
    if (!pfiCapacityMap[String(depotKey)]) pfiCapacityMap[String(depotKey)] = pfiCapacityMap[depotKey];
    const available = Math.max(
      0,
      Number(pfi.startingQtyLitres || 0) - Number(pfi.soldQtyLitres || 0)
    );
    pfiCapacityMap[depotKey][prodKey] =
      (pfiCapacityMap[depotKey][prodKey] || 0) + available;
    pfiCapacityMap[depotKey][String(prodKey)] = pfiCapacityMap[depotKey][prodKey];
  }

  return pfiCapacityMap;
}

/**
 * Find one or more PFIs that can collectively fulfil an order.
 *
 * When a single PFI has enough stock it is returned alone (backward-compatible
 * behaviour). When stock is spread across multiple PFIs a greedy fill picks
 * enough PFIs to cover the requested quantity.
 *
 * @returns {{ allocations: Array<{pfi: object, quantity: number}>, totalAvailableStock: number }}
 *   allocations — PFI + quantity pairs to reserve (empty when stock is short)
 *   totalAvailableStock — sum of all available PFI stock (for error messages)
 */
async function findPfiForOrder(depotId, productId, quantity) {
  const activePfis = await pfiRepo.findActiveByDepotAndProduct(depotId, productId);

  const needed = Number(quantity);
  let remaining = needed;
  const allocations = [];
  let totalAvailableStock = 0;

  for (const pfi of activePfis) {
    if (remaining <= 0) break;
    const available = Math.max(
      0,
      (pfi.startingQtyLitres || 0) - (pfi.soldQtyLitres || 0)
    );
    if (available <= 0) continue;
    totalAvailableStock += available;

    const take = Math.min(available, remaining);
    allocations.push({ pfi, quantity: take });
    remaining -= take;
  }

  return { allocations, totalAvailableStock };
}

module.exports = {
  getAvailableCapacity,
  getDepotCapacities,
  getMultiDepotCapacities,
  findPfiForOrder,
};
