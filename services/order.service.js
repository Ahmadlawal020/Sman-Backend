const { v4: uuidv4 } = require("uuid");
const { db } = require("../config/db");
const {
  orderRepo,
  customerRepo,
  depotRepo,
  pfiRepo,
  orderTruckRepo,
  auditLogRepo,
} = require("../repositories");
const walletService = require("./wallet.service");
const { createDedicatedAccount } = require("./payment.service");
const { sendOrderInvoiceEmail } = require("./email.service");
const { sendOrderSummarySMS } = require("./sms.service");
const { findPfiForOrder } = require("./pfi.service");
const { generateTicketForOrder } = require("./ticket.service");
const orderStatus = require("./orderStatus.service");
const { getCustomerInitials } = require("../utils/helpers");

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/**
 * Place an order — the ONE creation path, shared by the desk
 * (POST /api/orders) and the customer portal (POST /api/customer/orders).
 *
 * The only thing that differs between the two callers is WHO the customer is:
 * the desk passes a body customer id, the portal passes the authenticated
 * customer's own id. Everything else — server-side pricing, the dedicated
 * virtual account, the single atomic reserve→debit→create→ledger→capacity
 * transaction, the wallet-pays Pending→Paid transition, and the best-effort
 * invoice email/SMS — is identical, so it lives here once.
 *
 * Throws httpError(4xx) for a bad request (unknown depot, no price, no stock,
 * no payment account); the caller's asyncHandler renders it. External work
 * (DVA creation, email, SMS) stays OUTSIDE the DB transaction — a transaction
 * must never be held open across an HTTP call to Paystack/Termii.
 *
 * @param {object} input
 * @param {number} input.customerId
 * @param {string} input.state
 * @param {number} input.depotId
 * @param {number} input.productId
 * @param {number} input.quantity
 * @param {"delivery"|"pickup"} input.deliveryType
 * @param {Array<{truckNumber?: string, quantity: number, driverName?: string, driverPhone?: string}>} [input.trucks]
 *        Pickup only: the customer's declared trucks and the quantity on each.
 *        Their quantities must sum to the order quantity; each ≤ 60,000 L.
 * @param {{type: "staff"|"customer"|"system", staffId?: number, customerId?: number}} [input.actor]
 *        Who is placing the order — recorded on the order.created audit row.
 * @param {string|null} [input.idempotencyKey]
 *        Dedupe key for redeliverable requests (WhatsApp passes the wamid).
 *        Same key twice → the original order back, alreadyProcessed: true.
 * @returns {{ order: object, payment: object, isPaidWithWallet: boolean, alreadyProcessed?: boolean }}
 */

/** The answer an idempotent replay gets: the original order, not a new one. */
async function replayResult(orderId) {
  const fullOrder = await orderRepo.findByIdFull(orderId);
  return {
    order: fullOrder,
    isPaidWithWallet: fullOrder.paymentStatus === "Paid",
    alreadyProcessed: true,
    payment: {
      accountNumber: fullOrder.virtualAccountNumber,
      bankName: fullOrder.virtualAccountBank,
      accountName: fullOrder.virtualAccountName,
      emailSent: false,
      smsSent: false,
    },
  };
}

// Only the idempotency-key index counts — an orderNumber collision (or any
// other 23505) must still surface as the error it is.
const isIdempotencyConflict = (err) => {
  const code = err?.code || err?.cause?.code;
  const constraint = err?.constraint_name || err?.cause?.constraint_name || "";
  return code === "23505" && constraint === "orders_idempotency_key_idx";
};

async function placeOrder({
  customerId,
  state,
  depotId,
  productId,
  quantity,
  deliveryType,
  trucks,
  actor = { type: "system" },
  // Callers whose requests can be redelivered (the WhatsApp CONFIRM step
  // passes the inbound message's wamid) supply a key; a second call with the
  // same key returns the original order instead of creating a duplicate.
  idempotencyKey = null,
}) {
  if (idempotencyKey) {
    const existing = await orderRepo.findByIdempotencyKey(idempotencyKey);
    if (existing) return replayResult(existing.id);
  }

  const customer = await customerRepo.findById(customerId);
  if (!customer) {
    throw httpError(404, "Customer not found");
  }

  // Ensure the customer has a dedicated virtual account to be paid into.
  let virtualAccountNumber = customer.virtualAccountNumber || "";
  let virtualAccountBank = customer.virtualAccountBank || "";
  let virtualAccountName = customer.virtualAccountName || "";

  if (!virtualAccountNumber) {
    const accountResult = await createDedicatedAccount(customer);
    if (accountResult.success) {
      virtualAccountNumber = accountResult.data.accountNumber;
      virtualAccountBank = accountResult.data.bankName;
      virtualAccountName =
        accountResult.data.accountName || `SOROMANNIGERI/ ${getCustomerInitials(customer.name)}`;
      const updateData = { virtualAccountNumber, virtualAccountBank, virtualAccountName };
      if (accountResult.data.paystackCustomerId) {
        updateData.paystackCustomerId = accountResult.data.paystackCustomerId;
      }
      await customerRepo.update(customerId, updateData);
    } else {
      throw httpError(
        400,
        "Customer has no dedicated payment account and one could not be generated. Please try again or contact support."
      );
    }
  } else if (!virtualAccountName) {
    virtualAccountName = `SOROMANNIGERI/ ${getCustomerInitials(customer.name)}`;
    await customerRepo.update(customerId, { virtualAccountName });
  }

  const depot = await depotRepo.findById(depotId);
  if (!depot) {
    throw httpError(404, "Depot not found");
  }

  // Server-side pricing — the client never supplies price/total.
  const priceEntry = await depotRepo.getProductPrice(depotId, productId);
  if (!priceEntry || Number(priceEntry.currentPrice) <= 0) {
    throw httpError(400, "No price configured for this product at this depot");
  }
  const serverPrice = Number(priceEntry.currentPrice);
  const totalAmount = serverPrice * Number(quantity);

  const { selectedPfi: pfiDoc, totalAvailableStock } = await findPfiForOrder(
    depotId,
    productId,
    quantity
  );
  if (!pfiDoc) {
    if (totalAvailableStock < Number(quantity)) {
      throw httpError(
        400,
        `Insufficient stock in depot. Total active PFI stock: ${totalAvailableStock.toLocaleString()} Litres`
      );
    }
    throw httpError(
      400,
      `Insufficient stock in any single active PFI. Maximum available in a single PFI is less than the requested ${Number(
        quantity
      ).toLocaleString()} Litres`
    );
  }

  // --- Pickup truck declaration ---------------------------------------------
  // A pickup customer brings their own trucks and may split the order across
  // several — required once the order exceeds one tanker (60,000 L). They set
  // the quantity per truck here; the plate is optional (it can be filled or
  // corrected at the gate and at ticketing). Delivery orders never carry trucks
  // at order time — their fleet is allocated at release.
  const declaredTrucks = Array.isArray(trucks) ? trucks : [];
  if (deliveryType === "delivery" && declaredTrucks.length) {
    throw httpError(400, "Delivery trucks are allocated at release, not at order");
  }
  if (deliveryType === "pickup") {
    if (declaredTrucks.length) {
      const sum = declaredTrucks.reduce((s, t) => s + Number(t.quantity), 0);
      if (sum !== Number(quantity)) {
        throw httpError(
          400,
          `The truck quantities (${sum.toLocaleString()} L) must sum to the order quantity (${Number(
            quantity
          ).toLocaleString()} L)`
        );
      }
      const tooBig = declaredTrucks.find((t) => Number(t.quantity) > 60000);
      if (tooBig) {
        throw httpError(400, "Each truck can carry at most 60,000 L — split the load across more trucks");
      }
    } else if (Number(quantity) > 60000) {
      throw httpError(
        400,
        "A pickup over 60,000 L must be split across trucks — declare each truck and its quantity"
      );
    }
  }

  const orderNumber = `ORD-${uuidv4().replace(/-/g, "").slice(0, 12).toUpperCase()}`;

  // --- Atomic order creation (AUDIT H2) --------------------------------------
  // Stock reservation, the order row, the wallet HOLD, the capacity change, the
  // declared pickup loads and the Pending→Paid transition are ONE unit: a
  // failure anywhere rolls all of it back. A guarded write returning null
  // (stock claimed) is a lost race → a { status: 400 } that rolls back.
  let order, isPaidWithWallet;
  try {
    ({ order, isPaidWithWallet } = await db.transaction(async (tx) => {
    const updatedPfi = await pfiRepo.reserveStock(pfiDoc.id, Number(quantity), tx);
    if (!updatedPfi) {
      throw httpError(
        400,
        "Insufficient stock in the selected PFI (may have been claimed by another order)"
      );
    }
    await pfiRepo.markFinishedIfComplete(updatedPfi.id, tx);

    // The order is created first (the hold needs its id), Unpaid — its payment
    // status becomes true only if the hold below actually funds it.
    const created = await orderRepo.create(
      {
        orderNumber,
        customerId,
        state,
        depotId,
        productId,
        pfiId: updatedPfi.id,
        quantity: Number(quantity),
        price: String(serverPrice),
        totalAmount: String(totalAmount),
        deliveryType,
        status: "Pending",
        paymentStatus: "Unpaid",
        virtualAccountNumber,
        virtualAccountBank,
        virtualAccountName,
        idempotencyKey,
      },
      tx
    );

    // Every order gets a creation entry in the audit trail — not only its later
    // state transitions. A Pending, never-funded order still has a record of who
    // placed it, when, and for how much.
    await auditLogRepo.record(
      {
        entityType: "order",
        entityId: created.id,
        action: "order.created",
        actor,
        metadata: {
          orderNumber,
          deliveryType,
          quantity: Number(quantity),
          totalAmount: String(totalAmount),
        },
      },
      tx
    );

    // Commit the wallet funds as a HOLD, inside this same transaction (the tx is
    // threaded through placeHold). The hold reserves the money without spending
    // it: convertHold books the debit ledger row when the order completes;
    // releaseHold returns it on cancel. placeHold's guarded debit is the
    // sufficiency check — it fails cleanly if the balance can't cover it, and
    // the order simply stays Unpaid to be funded later by Paystack.
    const holdResult = await walletService.placeHold(
      {
        customerId,
        orderId: created.id,
        amount: totalAmount,
        description: `Payment hold for Order ${orderNumber} (Wallet Balance)`,
      },
      tx
    );
    const paid = holdResult.success;

    await depotRepo.decrementProductCapacity(depotId, productId, Number(quantity), tx);

    // Pickup: materialise the customer's declared trucks as pending loads now,
    // one row per truck (plate + its quantity), inside the same transaction.
    // The gate flow later flips each to gated_in → loaded → gated_out, and the
    // plate can be corrected at the gate and at ticketing. Delivery declares no
    // trucks here (allocated at release).
    for (let i = 0; i < declaredTrucks.length; i += 1) {
      const t = declaredTrucks[i];
      const load = await orderTruckRepo.create(
        {
          orderId: created.id,
          truckIndex: i + 1,
          truckId: null,
          // optionalString yields "" for an omitted plate/driver — store null so
          // an undeclared plate is a clean "to be captured at the gate".
          truckNumber: t.truckNumber || null,
          quantity: String(t.quantity),
          driverName: t.driverName || null,
          driverPhone: t.driverPhone || null,
          status: "pending",
        },
        tx
      );
      await auditLogRepo.record(
        {
          entityType: "order_truck",
          entityId: load.id,
          action: "order_truck.allocated",
          actor,
          metadata: { orderId: created.id, truckIndex: i + 1, truckNumber: load.truckNumber, quantity: String(t.quantity), via: "pickup-declaration" },
        },
        tx
      );
    }

    // A funded hold confirms the order NOW — drive Pending→Paid through the
    // state machine (system actor), stamping paymentStatus in the same update so
    // there is no window where status and paymentStatus disagree. The spend is
    // not booked yet; convertHold does that when the order completes.
    let orderRow = created;
    if (paid) {
      orderRow = await orderStatus.transition(created.id, "Paid", {
        tx,
        actor: { type: "system" },
        action: "order.paid",
        set: { paymentConfirmedAt: new Date(), paymentStatus: "Paid" },
        metadata: { via: "wallet", amount: String(totalAmount) },
      });
    }

    return { order: orderRow, isPaidWithWallet: paid };
    }));
  } catch (err) {
    // Two same-key requests racing: the loser's insert hits the partial unique
    // index and its whole transaction rolls back (no stock burnt, no hold).
    // Answer with the winner's order — same as the early replay check.
    if (idempotencyKey && isIdempotencyConflict(err)) {
      const existing = await orderRepo.findByIdempotencyKey(idempotencyKey);
      if (existing) return replayResult(existing.id);
    }
    throw err;
  }

  // --- Post-commit side effects. The order is durable; these are best-effort.
  if (isPaidWithWallet) {
    try {
      await generateTicketForOrder(order.id);
    } catch (ticketErr) {
      console.error("Failed to generate ticket on instant wallet payment:", ticketErr.message);
    }
  }

  const fullOrder = await orderRepo.findByIdFull(order.id);

  if (customer.email) {
    try {
      await sendOrderInvoiceEmail(customer.email, {
        orderNumber,
        orderDate: order.createdAt,
        customerName: customer.name,
        companyName: customer.companyName,
        customerPhone: customer.phone,
        product: fullOrder.productName || "N/A",
        sku: fullOrder.productSku || "",
        quantity: order.quantity,
        unit: fullOrder.productUnit || "Liters",
        price: order.price,
        totalAmount: order.totalAmount,
        deliveryType: order.deliveryType,
        depotName: depot.name,
        depotCode: depot.code,
        state: order.state,
        accountNumber: virtualAccountNumber,
        bankName: virtualAccountBank,
        accountName: virtualAccountName,
      });
    } catch (emailErr) {
      console.error("Failed to send invoice email:", emailErr.message);
    }
  }

  let smsSent = false;
  try {
    const smsResult = await sendOrderSummarySMS(customer.phone, {
      orderNumber,
      customerName: customer.name,
      product: fullOrder.productName || "N/A",
      quantity: order.quantity,
      unit: fullOrder.productUnit || "Liters",
      totalAmount: order.totalAmount,
      accountNumber: virtualAccountNumber,
      bankName: virtualAccountBank,
      accountName: virtualAccountName,
    });
    smsSent = smsResult.success;
    if (!smsSent) console.error("Failed to send order SMS:", smsResult.message);
  } catch (smsErr) {
    console.error("Failed to send order SMS:", smsErr.message);
  }

  return {
    order: fullOrder,
    isPaidWithWallet,
    payment: {
      accountNumber: virtualAccountNumber,
      bankName: virtualAccountBank,
      accountName: virtualAccountName,
      emailSent: !!customer.email,
      smsSent,
    },
  };
}

/**
 * Cancel a live order (any status through Released). One transaction: the
 * state machine locks the row and rejects an illegal or concurrent cancel
 * BEFORE any restitution, then stock release, capacity restore and the hold
 * release run as the same unit. Shared by the staff endpoint and the
 * WhatsApp customer cancel — the actor in the audit row tells them apart.
 */
async function cancelOrder({
  orderId,
  actor,
  reason = null,
  cancelledBy = null,
  ipAddress = null,
  userAgent = null,
}) {
  return db.transaction(async (tx) => {
    const order = await orderStatus.transition(orderId, "Cancelled", {
      tx,
      actor,
      set: {
        cancelledAt: new Date(),
        cancelledBy,
        cancellationReason: reason,
      },
      metadata: { reason, refunded: false },
      ipAddress,
      userAgent,
    });

    if (order.pfiId) {
      await pfiRepo.releaseStock(order.pfiId, order.quantity, tx);
    }
    await depotRepo.incrementProductCapacity(order.depotId, order.productId, order.quantity, tx);

    // Return any held funds. The hold — not a debit/credit pair — is the
    // record, so a cancelled order leaves no ledger churn. On an Unpaid order
    // there is no active hold and this is a no-op.
    await walletService.releaseHold(order.id, tx);

    return order;
  });
}

module.exports = { placeOrder, cancelOrder, httpError };
