const { deliveryInventoryRepo, deliveryCustomerRepo } = require("../repositories");
const { emitEvent } = require("./events");

// Allocation release workflow, same as the Django flow: pending -> confirmed
// -> released, one-way. Releasing assigns the delivery ticket; the financial
// record stays in delivery_sales — the simple ledger staff key in manually,
// exactly as the existing screens expect. Nothing here writes sales rows.

const TRANSITIONS = {
  pending: ["confirmed"],
  confirmed: ["released"],
  released: [],
};

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

/**
 * The allocation's buyer sits in `delivery_customers`, which is a separate
 * register from the portal `customers` table — a delivery customer has no
 * account, no app and no inbox. A phone number is therefore the ONLY way to
 * reach them, which is why every delivery event carries one rather than a
 * customer id. Failing to find them must never block the transition itself.
 */
const customerPhoneFor = async (allocation) => {
  if (!allocation?.customerId) return "";
  try {
    const customer = await deliveryCustomerRepo.findById(allocation.customerId);
    return customer?.phoneNumber || "";
  } catch (err) {
    console.error("[delivery] customer lookup for notification failed:", err.message);
    return "";
  }
};

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
    allocation: updated,
    customerPhone: await customerPhoneFor(updated),
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

  emitEvent("delivery.released", {
    actor,
    entityType: "delivery_inventory",
    entityId: allocationId,
    allocation: updated,
    customerPhone: await customerPhoneFor(allocation),
  });

  return { success: true, allocation: updated };
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
    allocation: updated,
    customerPhone: await customerPhoneFor(allocation),
  });

  return { success: true, allocation: updated };
};

module.exports = { confirmAllocation, releaseAllocation, rejectAllocation };
