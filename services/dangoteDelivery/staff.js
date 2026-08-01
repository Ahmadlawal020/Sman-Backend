const { transition } = require("./transitions");
const { DangoteOrderError } = require("./orders");
const { createDedicatedAccount } = require("../payment.service");
const { getCustomerInitials } = require("../../utils/helpers");

// Staff-side (quote desk) business rules. The invariant that matters most:
// a quote can only be issued when every document on the request is VERIFIED —
// the machine's APPROVED gate is where compliance actually bites.

/**
 * Ensure the customer has a dedicated virtual account and snapshot it onto
 * the order. Failures are logged, never fatal — the quote stands even if the
 * payment provider hiccups; the DVA can be retried on next approval.
 */
const ensureDvaSnapshot = async (customerRepo, orderRepo, { order, customer }) => {
  let virtualAccountNumber = customer?.virtualAccountNumber || "";
  let virtualAccountBank = customer?.virtualAccountBank || "";
  let virtualAccountName = customer?.virtualAccountName || "";

  if (!virtualAccountNumber && customer) {
    try {
      const accountResult = await createDedicatedAccount(customer);
      if (accountResult.success) {
        virtualAccountNumber = accountResult.data.accountNumber;
        virtualAccountBank = accountResult.data.bankName;
        virtualAccountName =
          accountResult.data.accountName ||
          `SOROMANNIGERI/ ${getCustomerInitials(customer.name)}`;
        const updateData = { virtualAccountNumber, virtualAccountBank, virtualAccountName };
        if (accountResult.data.paystackCustomerId) {
          updateData.paystackCustomerId = accountResult.data.paystackCustomerId;
        }
        await customerRepo.update(customer.id, updateData);
      } else {
        console.error("Failed to create DVA for customer:", accountResult.message);
      }
    } catch (dvaErr) {
      console.error("DVA creation error:", dvaErr.message);
    }
  } else if (!virtualAccountName && customer) {
    virtualAccountName = `SOROMANNIGERI/ ${getCustomerInitials(customer.name)}`;
    await customerRepo.update(customer.id, { virtualAccountName });
  }

  await orderRepo.update(order.id, {
    virtualAccountNumber,
    virtualAccountBank,
    virtualAccountName,
  });

  return { virtualAccountNumber, virtualAccountBank, virtualAccountName };
};

/**
 * Approve with a quote: every document VERIFIED, then one transition carrying
 * the quote fields, then DVA snapshot + notifications.
 */
const quoteAndApprove = async (
  { customerRepo, orderRepo, licenseRepo },
  { order, staffId, unitPrice, deliveryPrice, expectedArrivalDate }
) => {
  if (order.status !== "UNDER_REVIEW") {
    throw new DangoteOrderError(`Cannot quote a ${order.status} order`, 409);
  }

  const price = Number(unitPrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new DangoteOrderError("Unit price must be a positive amount");
  }

  // Compliance gate: the order's linked customer license must be VERIFIED and
  // unexpired. Verified once on the license, reused across the customer's orders.
  if (!order.licenseId) {
    throw new DangoteOrderError("Cannot approve: no license is attached to this request", 409);
  }
  const license = await licenseRepo.findById(order.licenseId);
  if (!license || license.status !== "VERIFIED") {
    throw new DangoteOrderError("Cannot approve: the attached license must be verified first", 409);
  }
  if (license.expiryDate && new Date(license.expiryDate) < new Date(new Date().toDateString())) {
    throw new DangoteOrderError("Cannot approve: the attached license has expired", 409);
  }

  const delivery = Number(deliveryPrice || 0);
  const totalAmount = price * order.quantity + delivery;

  // Ensure + snapshot the DVA BEFORE the transition, so the APPROVED event
  // (and the notification consumer reacting to it) sees the payment account.
  const customer = await customerRepo.findById(order.customerId);
  await ensureDvaSnapshot(customerRepo, orderRepo, { order, customer });

  await transition(order, "APPROVED", {
    actorType: "staff",
    actorId: staffId,
    set: {
      unitPrice: String(price),
      deliveryPrice: String(delivery),
      totalAmount: String(totalAmount),
      expectedArrivalDate: expectedArrivalDate || "",
      quotedBy: staffId,
      quotedAt: new Date(),
      reviewedBy: staffId,
      reviewedAt: new Date(),
    },
  });

  // The quote-ready email + SMS are sent by the notification consumer off the
  // dangote_delivery.status_changed event — no send calls in the desk logic.
  return orderRepo.findById(order.id);
};

/** Send back for fixes; the note is required — it's what the customer reads. */
const requestChanges = async ({ order, staffId, note }) => {
  if (!note || !note.trim()) {
    throw new DangoteOrderError("A note explaining the required changes is needed");
  }
  return transition(order, "NEEDS_CHANGES", {
    actorType: "staff",
    actorId: staffId,
    note: note.trim(),
    set: { reviewedBy: staffId, reviewedAt: new Date() },
  });
};

const rejectRequest = async ({ order, staffId, reason }) => {
  if (!reason || !reason.trim()) {
    throw new DangoteOrderError("A rejection reason is required");
  }
  return transition(order, "REJECTED", {
    actorType: "staff",
    actorId: staffId,
    note: reason.trim(),
    set: { reviewedBy: staffId, reviewedAt: new Date() },
  });
};

/** Manual payment confirmation (until the payment effort lands): → PAID. */
const markPaid = async ({ order, staffId }) => {
  let current = order;
  if (current.status === "APPROVED") {
    current = await transition(current, "PAYMENT_PENDING", {
      actorType: "staff",
      actorId: staffId,
    });
  }
  return transition(current, "PAID", {
    actorType: "staff",
    actorId: staffId,
    note: "Payment confirmed manually by staff",
  });
};

// Staff manually advance fulfilment — the ops-preferred model (no truck
// records). Each step is its own deliberate action and timeline entry.
const FULFILMENT_STEPS = {
  schedule: "SCHEDULED",
  dispatch: "DISPATCHED",
  complete: "COMPLETED",
};

const advanceFulfilment = async ({ order, staffId, step, note }) => {
  const target = FULFILMENT_STEPS[step];
  if (!target) {
    throw new DangoteOrderError(`Unknown fulfilment step: ${step}`);
  }
  return transition(order, target, {
    actorType: "staff",
    actorId: staffId,
    note: note || "",
  });
};

module.exports = {
  quoteAndApprove,
  requestChanges,
  rejectRequest,
  markPaid,
  advanceFulfilment,
  ensureDvaSnapshot,
};
