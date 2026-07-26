const { deliveryInventoryRepo, deliveryCustomerRepo } = require("../repositories");
const ledgerService = require("./ledger.service");
const { emitEvent } = require("./events");

// Allocation release workflow: pending -> confirmed -> released. One-way.
// Releasing is the financial moment — the sale hits the customer's delivery
// ledger there, exactly once (idempotent by allocation reference).

const TRANSITIONS = {
  pending: ["confirmed"],
  confirmed: ["released"],
  released: [],
};

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

const confirmAllocation = async (allocationId, { actor }) => {
  const allocation = await deliveryInventoryRepo.findById(allocationId);
  if (!allocation) return { success: false, notFound: true, message: "Allocation not found" };

  if (!canTransition(allocation.releaseStatus, "confirmed")) {
    return {
      success: false,
      message: `Cannot confirm an allocation in '${allocation.releaseStatus}' state`,
    };
  }

  const updated = await deliveryInventoryRepo.update(allocationId, {
    releaseStatus: "confirmed",
    confirmedBy: actor?.name || "",
    confirmedAt: new Date(),
  });

  emitEvent("delivery.confirmed", {
    actor,
    entityType: "delivery_inventory",
    entityId: allocationId,
    allocationCode: updated.allocationCode || "",
  });

  return { success: true, allocation: updated };
};

const releaseAllocation = async (allocationId, { actor }) => {
  const allocation = await deliveryInventoryRepo.findById(allocationId);
  if (!allocation) return { success: false, notFound: true, message: "Allocation not found" };

  if (!canTransition(allocation.releaseStatus, "released")) {
    return {
      success: false,
      message: `Cannot release an allocation in '${allocation.releaseStatus}' state — confirm it first`,
    };
  }

  const ticketNumber =
    allocation.ticketNumber || `DLV-${String(allocationId).padStart(6, "0")}`;

  const updated = await deliveryInventoryRepo.update(allocationId, {
    releaseStatus: "released",
    releasedBy: actor?.name || "",
    releasedAt: new Date(),
    ticketNumber,
    ticketGeneratedAt: allocation.ticketGeneratedAt || new Date(),
  });

  // Post the sale to the customer's delivery ledger. Reference makes a retry
  // (double-click, replay) a no-op instead of a second sale.
  let ledgerEntry = null;
  const quantity = Number(allocation.quantityAllocated || 0);
  const rate = Number(allocation.rate || 0);
  const salesValue = quantity * rate;
  if (allocation.customerId && salesValue > 0) {
    const customer = await deliveryCustomerRepo.findById(allocation.customerId);
    const posted = await ledgerService.postEntry({
      ownerType: "delivery_customer",
      ownerId: allocation.customerId,
      ownerName: customer?.name || allocation.customerName || "",
      direction: "debit",
      category: "sale",
      amount: salesValue,
      description: `Delivery release ${ticketNumber} — ${quantity.toLocaleString()}L @ ${rate}`,
      reference: `delivery-release-${allocationId}`,
      metadata: { allocationId, allocationCode: allocation.allocationCode || "", quantity, rate },
      recordedBy: actor?.id || null,
      actor,
    });
    ledgerEntry = posted.entry || null;
  }

  emitEvent("delivery.released", {
    actor,
    entityType: "delivery_inventory",
    entityId: allocationId,
    allocation: updated,
    customerPhone: allocation.customerId
      ? (await deliveryCustomerRepo.findById(allocation.customerId))?.phoneNumber
      : "",
  });

  return { success: true, allocation: updated, ledgerEntry };
};

const rejectAllocation = async (allocationId, { actor, reason = "" }) => {
  const allocation = await deliveryInventoryRepo.findById(allocationId);
  if (!allocation) return { success: false, notFound: true, message: "Allocation not found" };

  if (allocation.releaseStatus === "released") {
    return { success: false, message: "Cannot reject an already-released allocation" };
  }

  const updated = await deliveryInventoryRepo.update(allocationId, {
    releaseStatus: "pending",
    rejectionReason: reason,
    confirmedBy: "",
    confirmedAt: null,
  });

  emitEvent("delivery.rejected", {
    actor,
    entityType: "delivery_inventory",
    entityId: allocationId,
    reason,
  });

  return { success: true, allocation: updated };
};

module.exports = { confirmAllocation, releaseAllocation, rejectAllocation };
