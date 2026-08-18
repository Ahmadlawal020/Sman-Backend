const { pfiRepo } = require("../repositories");

/**
 * consumer_pfi (live) has no soldQtyLitres column — "sold" is
 * SUM(consumer_pfimovement.qty_litres) for that PFI, an append-only ledger
 * (see repositories/pfi.repository.js's header comment and getSoldQty).
 * Every "available = starting - sold" computation below now asks the ledger
 * instead of reading a stored counter.
 */

async function getAvailableCapacity(depotId, productId) {
  const activePfis = await pfiRepo.findActiveByLocationAndProduct(depotId, productId);

  let total = 0;
  for (const pfi of activePfis) {
    const sold = await pfiRepo.getSoldQty(pfi.id);
    total += Math.max(0, (pfi.startingQtyLitres || 0) - sold);
  }
  return total;
}

async function getDepotCapacities(depotId) {
  const { db } = require("../config/db");
  const { consumerPfi, consumerPfimovement } = require("../db/schema");
  const { eq, and, sql } = require("drizzle-orm");

  const numericDepotId = parseInt(depotId, 10);
  if (isNaN(numericDepotId)) return {};

  // One query: starting stock per PFI minus its ledger sold total, grouped
  // by product. consumer_pfi.locationId is actually a STATE id, not a
  // depot id (see pfi.repository.js) — this function's name is now the old
  // clean-room vocabulary for what's really "capacity for this state".
  const rows = await db
    .select({
      productId: consumerPfi.productId,
      available: sql`SUM(${consumerPfi.startingQtyLitres}::numeric - COALESCE((
        SELECT SUM(${consumerPfimovement.qtyLitres}::numeric) FROM ${consumerPfimovement}
        WHERE ${consumerPfimovement.pfiId} = ${consumerPfi.id}
      ), 0))`.mapWith(Number),
    })
    .from(consumerPfi)
    .where(and(eq(consumerPfi.locationId, numericDepotId), eq(consumerPfi.status, "active")))
    .groupBy(consumerPfi.productId);

  const capacityMap = {};
  for (const row of rows) {
    if (!row.productId) continue;
    const available = Math.max(0, row.available || 0);
    capacityMap[row.productId] = available;
    capacityMap[String(row.productId)] = available;
  }
  return capacityMap;
}

async function getMultiDepotCapacities(depotIds) {
  const { db } = require("../config/db");
  const { consumerPfi, consumerPfimovement } = require("../db/schema");
  const { eq, and, inArray, sql } = require("drizzle-orm");

  const numericIds = (depotIds || []).map((id) => parseInt(id, 10)).filter((n) => !isNaN(n));
  if (numericIds.length === 0) return {};

  const rows = await db
    .select({
      locationId: consumerPfi.locationId,
      productId: consumerPfi.productId,
      available: sql`SUM(${consumerPfi.startingQtyLitres}::numeric - COALESCE((
        SELECT SUM(${consumerPfimovement.qtyLitres}::numeric) FROM ${consumerPfimovement}
        WHERE ${consumerPfimovement.pfiId} = ${consumerPfi.id}
      ), 0))`.mapWith(Number),
    })
    .from(consumerPfi)
    .where(and(inArray(consumerPfi.locationId, numericIds), eq(consumerPfi.status, "active")))
    .groupBy(consumerPfi.locationId, consumerPfi.productId);

  const pfiCapacityMap = {};
  for (const row of rows) {
    if (!row.productId) continue;
    const depotKey = row.locationId;
    if (!pfiCapacityMap[depotKey]) pfiCapacityMap[depotKey] = {};
    if (!pfiCapacityMap[String(depotKey)]) pfiCapacityMap[String(depotKey)] = pfiCapacityMap[depotKey];
    const available = Math.max(0, row.available || 0);
    pfiCapacityMap[depotKey][row.productId] = available;
    pfiCapacityMap[depotKey][String(row.productId)] = available;
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
  const activePfis = await pfiRepo.findActiveByLocationAndProduct(depotId, productId);

  const needed = Number(quantity);
  let remaining = needed;
  const allocations = [];
  let totalAvailableStock = 0;

  for (const pfi of activePfis) {
    if (remaining <= 0) break;
    const sold = await pfiRepo.getSoldQty(pfi.id);
    const available = Math.max(0, (pfi.startingQtyLitres || 0) - sold);
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
