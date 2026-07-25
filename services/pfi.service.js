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

  const activePfis = await db
    .select({
      productId: pfis.productId,
      startingQtyLitres: pfis.startingQtyLitres,
      soldQtyLitres: pfis.soldQtyLitres,
    })
    .from(pfis)
    .where(and(eq(pfis.locationId, depotId), eq(pfis.status, "active")));

  const capacityMap = {};
  for (const pfi of activePfis) {
    const prodKey = pfi.productId;
    if (!prodKey) continue;
    const available = Math.max(
      0,
      (pfi.startingQtyLitres || 0) - (pfi.soldQtyLitres || 0)
    );
    capacityMap[prodKey] = (capacityMap[prodKey] || 0) + available;
  }

  return capacityMap;
}

async function getMultiDepotCapacities(depotIds) {
  const { db } = require("../config/db");
  const { pfis } = require("../db/schema");
  const { eq, and, inArray } = require("drizzle-orm");

  const activePfis = await db
    .select({
      locationId: pfis.locationId,
      productId: pfis.productId,
      startingQtyLitres: pfis.startingQtyLitres,
      soldQtyLitres: pfis.soldQtyLitres,
    })
    .from(pfis)
    .where(and(inArray(pfis.locationId, depotIds), eq(pfis.status, "active")));

  const pfiCapacityMap = {};
  for (const pfi of activePfis) {
    const depotKey = pfi.locationId;
    const prodKey = pfi.productId;
    if (!prodKey) continue;
    if (!pfiCapacityMap[depotKey]) pfiCapacityMap[depotKey] = {};
    const available = Math.max(
      0,
      (pfi.startingQtyLitres || 0) - (pfi.soldQtyLitres || 0)
    );
    pfiCapacityMap[depotKey][prodKey] =
      (pfiCapacityMap[depotKey][prodKey] || 0) + available;
  }

  return pfiCapacityMap;
}

async function findPfiForOrder(depotId, productId, quantity) {
  const activePfis = await pfiRepo.findActiveByDepotAndProduct(depotId, productId);

  let selectedPfi = null;
  let totalAvailableStock = 0;

  for (const pfi of activePfis) {
    const available = Math.max(
      0,
      (pfi.startingQtyLitres || 0) - (pfi.soldQtyLitres || 0)
    );
    if (available > 0) {
      totalAvailableStock += available;
      if (!selectedPfi && available >= Number(quantity)) {
        selectedPfi = pfi;
      }
    }
  }

  return { selectedPfi, totalAvailableStock };
}

module.exports = {
  getAvailableCapacity,
  getDepotCapacities,
  getMultiDepotCapacities,
  findPfiForOrder,
};
