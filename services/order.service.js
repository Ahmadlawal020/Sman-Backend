const { eq } = require("drizzle-orm");
const { db } = require("../config/db");
const { orderIdempotency } = require("../db/schema");
const {
  orderRepo,
  customerRepo,
  depotRepo,
  productRepo,
  pfiRepo,
  orderTruckRepo,
  orderPfiAllocationRepo,
  auditLogRepo,
  bankAccountRepo,
} = require("../repositories");
const walletService = require("./wallet.service");
// Paystack DVA creation/subaccount-switch and the auto-split transfer are
// disabled — see the "Paystack DVA funding (disabled...)" block below and
// runPostPaymentEffects(). Re-add this import if reinstating either:
// const { createDedicatedAccount, transferToDepotSubaccount, switchCustomerDvaToSubaccount } = require("./payment.service");
const { sendOrderInvoiceEmail } = require("./email.service");
const { sendOrderSummarySMS, sendOrderExpiredSMS } = require("./sms.service");
const { notify } = require("../notifications");
const { findPfiForOrder } = require("./pfi.service");
const { generateTicketForOrder } = require("./ticket.service");
const orderStatus = require("./orderStatus.service");
const commissionService = require("./commission.service");
const { QUEUES, enqueue } = require("../config/queue");

const notifyWhatsAppPaymentConfirmed = (orderId) => {
  if (process.env.WHATSAPP_ENABLED !== "true") return;
  enqueue(QUEUES.WA_EVENTS, { type: "payment_confirmed", orderId }).catch((err) =>
    console.error("[wa] payment-confirmed enqueue failed:", err.message)
  );
};

const { orderExpiryHours, orderExpiryMs } = require("../config/orderExpiry");

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/**
 * consumer_truckallocation.ticket_number is NOT NULL + UNIQUE with no DB
 * default — Django's own TruckAllocation.save() override auto-generates it
 * (soroman_backend-2/consumer/models.py) as TKT-<createdDate>-<orderId>-T<n>
 * when absent. Writing straight to Postgres bypasses that override, so this
 * mirrors it exactly rather than inventing a different format.
 */
function truckAllocationTicketNumber(orderId, truckNumber, when = new Date()) {
  const y = when.getFullYear();
  const m = String(when.getMonth() + 1).padStart(2, "0");
  const d = String(when.getDate()).padStart(2, "0");
  return `TKT-${y}${m}${d}-${orderId}-T${truckNumber}`;
}

/**
 * Has this order lapsed? Only a still-Pending, still-unpaid order can — once a
 * transfer or wallet settles it, the order is Paid and never expires.
 */
function isOrderExpired(order, now = Date.now()) {
  return (
    order.status === "Pending" &&
    order.paymentStatus !== "Paid" &&
    now - new Date(order.createdAt).getTime() >= orderExpiryMs()
  );
}

/**
 * Compute the expiration deadline for an order. Returns an ISO string if the
 * order is Pending and unpaid; null otherwise (Paid/Released/Completed orders
 * never expire, Expired/Cancelled orders already have expiredAt).
 */
function computeExpiresAt(order) {
  if (order.status !== "Pending" || order.paymentStatus === "Paid") return null;
  const created = new Date(order.createdAt).getTime();
  return new Date(created + orderExpiryMs()).toISOString();
}

/**
 * Enrich an order (or array of orders) with a computed `expiresAt` field — the
 * deadline before which the customer must pay. The frontend uses this directly
 * for the countdown badge instead of knowing ORDER_EXPIRY_HOURS.
 *
 * For single orders, also checks if the deadline has passed and immediately
 * expires the order before returning it. This ensures the frontend never sees
 * an order in the "imminent" window (deadline passed but not yet swept).
 */
async function withExpiresAt(orderOrOrders) {
  if (Array.isArray(orderOrOrders)) {
    const results = [];
    for (const o of orderOrOrders) {
      results.push(await expireAndAttach(o));
    }
    return results;
  }
  return expireAndAttach(orderOrOrders);
}

/**
 * Internal helper: expire an order if past its deadline, then attach expiresAt.
 */
async function expireAndAttach(order) {
  // If pending and unpaid, check if deadline has passed
  if (order.status === "Pending" && order.paymentStatus !== "Paid") {
    const deadline = new Date(order.createdAt).getTime() + orderExpiryMs();
    if (Date.now() >= deadline) {
      try {
        const expired = await expireOrder(order.id);
        return { ...expired, expiresAt: null };
      } catch {
        // Already expired or concurrent update — fall through with original
      }
    }
  }
  return { ...order, expiresAt: computeExpiresAt(order) };
}

/**
 * Place an order — the ONE creation path, shared by the desk
 * (POST /api/orders) and the customer portal (POST /api/customer/orders).
 *
 * The only thing that differs between the two callers is WHO the customer is:
 * the desk passes a body customer id, the portal passes the authenticated
 * customer's own id. Everything else — server-side pricing, the depot's
 * payment account, the single atomic reserve→debit→create→ledger
 * transaction, the wallet-pays Pending→Paid transition, and the best-effort
 * invoice email/SMS — is identical, so it lives here once.
 *
 * Throws httpError(4xx) for a bad request (unknown depot, no price, no stock,
 * no payment account); the caller's asyncHandler renders it. External work
 * (email, SMS) stays OUTSIDE the DB transaction — a transaction must never be
 * held open across an HTTP call to a third party.
 *
 * @param {object} input
 * @param {number} input.customerId
 * @param {string} input.state
 * @param {number} input.depotId
 * @param {number} input.productId
 * @param {number} input.quantity
 * @param {"delivery"|"pickup"} input.deliveryType
 * @param {string} [input.deliveryAddress]
 *        Delivery only: where the truck goes, in the customer's words.
 *        Ignored for pickup — the depot is the address.
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
      // consumer_order has no customer-DVA-style virtual account of its
      // own — paidToAccountNumber/Bank/Name is where WE told the customer
      // to pay (the depot's bank account), which is what the replay's
      // caller actually needs to show again.
      accountNumber: fullOrder.paidToAccountNumber,
      bankName: fullOrder.paidToBankName,
      accountName: fullOrder.paidToAccountName,
      emailSent: false,
      smsSent: false,
    },
  };
}

// Only sman.order_idempotency's own unique index counts — an unrelated
// 23505 (e.g. a truck-allocation ticket-number collision further down the
// same transaction) must still surface as the error it is, not be
// swallowed as a replay.
const isIdempotencyConflict = (err) => {
  const code = err?.code || err?.cause?.code;
  const constraint = err?.constraint_name || err?.cause?.constraint_name || "";
  return code === "23505" && constraint === "order_idempotency_key_idx";
};

async function placeOrder({
  customerId,
  state,
  depotId,
  productId,
  quantity,
  deliveryType,
  deliveryAddress,
  companyName,
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

  const depot = await depotRepo.findById(depotId);
  if (!depot) {
    throw httpError(404, "Depot not found");
  }

  /* --- Paystack DVA funding (disabled — manual deposit only) ---------------
   * Every customer used to get a personal Dedicated Virtual Account (DVA) on
   * first order, immediately split to the depot's Paystack subaccount so
   * funds settled straight there. Wallet funding is manual-deposit-only now
   * (staff record deposits from the admin dashboard against the depot's own
   * bank account, looked up below) — this whole path is parked, not deleted.
   * To reinstate: restore this block, drop the depot-bank-account lookup
   * beneath it, and uncomment the payment.service.js import above.
   *
   * let virtualAccountNumber = customer.virtualAccountNumber || "";
   * let virtualAccountBank = customer.virtualAccountBank || "";
   * let virtualAccountName = customer.virtualAccountName || "";
   *
   * if (!virtualAccountNumber) {
   *   const accountResult = await createDedicatedAccount(customer);
   *   if (accountResult.success) {
   *     virtualAccountNumber = accountResult.data.accountNumber;
   *     virtualAccountBank = accountResult.data.bankName;
   *     virtualAccountName =
   *       accountResult.data.accountName || formatVirtualAccountName(customer.name);
   *     const updateData = { virtualAccountNumber, virtualAccountBank, virtualAccountName };
   *     if (accountResult.data.paystackCustomerId) {
   *       updateData.paystackCustomerId = accountResult.data.paystackCustomerId;
   *     }
   *     await customerRepo.update(customerId, updateData);
   *   } else {
   *     throw httpError(
   *       400,
   *       "Customer has no dedicated payment account and one could not be generated. Please try again or contact support."
   *     );
   *   }
   * } else if (!virtualAccountName) {
   *   virtualAccountName = formatVirtualAccountName(customer.name);
   *   await customerRepo.update(customerId, { virtualAccountName });
   * }
   *
   * // Automatically switch customer DVA to depot Paystack Subaccount
   * const depotSubaccountCode = depot.paystackSubaccountCode || depot.paystack_subaccount_code;
   * if (virtualAccountNumber && depotSubaccountCode) {
   *   try {
   *     await switchCustomerDvaToSubaccount({
   *       accountNumber: virtualAccountNumber,
   *       subaccountCode: depotSubaccountCode,
   *     });
   *     await customerRepo.update(customerId, { dvaSubaccountCode: depotSubaccountCode });
   *   } catch (dvaErr) {
   *     console.error(`[placeOrder] Failed to switch DVA to subaccount for depot ${depotId}:`, dvaErr.message);
   *   }
   * }
   * --------------------------------------------------------------------- */

  // The account the customer pays into is the depot's own bank account, set
  // up by an admin on the dashboard (Bank Accounts, linked to this depot) —
  // not a per-customer virtual account. Every order at this depot shows the
  // same account; the default one wins when more than one is linked.
  const depotBankAccounts = await bankAccountRepo.findAll({ depotId: depot.id, status: "Active" });
  const depotBankAccount = depotBankAccounts.find((a) => a.isDefault) || depotBankAccounts[0];
  if (!depotBankAccount) {
    throw httpError(
      400,
      "No payment account has been set up for this depot yet. Please contact support."
    );
  }
  const virtualAccountNumber = depotBankAccount.accountNumber;
  const virtualAccountBank = depotBankAccount.bankName;
  const virtualAccountName = depotBankAccount.accountName;

  const product = await productRepo.findById(productId);
  if (!product) {
    throw httpError(404, "Product not found");
  }
  const productUnit = product.unit || "Liters";

  // Server-side pricing — the client never supplies price/total. Pricing is
  // state-scoped live (consumer_productprice keys on state, not depot — see
  // depot.repository.js's header comment), so resolve the depot's own state
  // first (where the product is priced/dispensed from), not the customer's
  // declared delivery state.
  const depotStateId = await depotRepo.getStateIdForDepot(depotId);
  const priceEntry = depotStateId ? await depotRepo.getProductPrice(depotStateId, productId) : null;
  if (!priceEntry || Number(priceEntry.price) <= 0) {
    throw httpError(400, "No price configured for this product at this depot");
  }
  const serverPrice = Number(priceEntry.price);
  const totalAmount = serverPrice * Number(quantity);

  // consumer_pfi.locationId is a state id, not a depot id (see
  // pfi.repository.js) — PFI stock is pooled per state, same resolution as
  // the price lookup above.
  const { allocations, totalAvailableStock } = await findPfiForOrder(
    depotStateId,
    productId,
    quantity
  );
  if (allocations.length === 0) {
    throw httpError(
      400,
      `Insufficient stock in depot. Total active PFI stock: ${totalAvailableStock.toLocaleString()} ${productUnit}`
    );
  }

  // --- Pickup truck declaration ---------------------------------------------
  // A pickup customer brings their own trucks and may split the order across
  // several. Declaring them at order time is optional at every quantity —
  // security still captures each arriving truck at the gate. When a split IS
  // declared it must be coherent: quantities sum to the order, each truck ≤
  // one tanker (60,000 L). The plate is optional (filled or corrected at the
  // gate and at ticketing). Delivery orders never carry trucks at order time
  // — their fleet is allocated at release.
  const declaredTrucks = Array.isArray(trucks) ? trucks : [];
  if (deliveryType === "delivery" && declaredTrucks.length) {
    throw httpError(400, "Delivery trucks are allocated at release, not at order");
  }
  if (deliveryType === "pickup" && declaredTrucks.length) {
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
  }

  // The live schema supports exactly ONE pfi per order (consumer_order.pfi_id
  // is a single FK, and consumer_pfimovement's unique constraint is on
  // (action, order_id) — one RELEASE row per order). findPfiForOrder can
  // still propose a greedy multi-PFI split when a single PFI falls short;
  // that split has no live representation, and silently reserving only the
  // first PFI would under-reserve the order without covering its full
  // quantity — refused rather than guessed.
  if (allocations.length > 1) {
    throw httpError(
      400,
      `This depot's available stock for ${productUnit} is split across ${allocations.length} separate batches (PFIs) and cannot be combined into one order on this schema. Reduce the quantity to fit within a single batch, or contact support.`
    );
  }
  const [{ pfi: reservedPfi, quantity: reservedQuantity }] = allocations;

  // consumer_order.state_id is a real FK, unlike consumer_depots' free-text
  // location — resolve the caller's declared state name to it, falling back
  // to the depot's own state (already resolved above for pricing) when the
  // name doesn't match a known state.
  const orderStateId = (await depotRepo.findStateIdByName(state)) || depotStateId;

  // --- Atomic order creation -------------------------------------------------
  // The order row must exist before stock can be reserved against it
  // (consumer_pfimovement.order_id is NOT NULL) — created first with pfiId
  // null, then backfilled once the reservation succeeds. Order, reservation
  // and declared pickup loads are ONE unit: a failure anywhere rolls all of
  // it back. Orders are always created Unpaid — payment happens later via a
  // manual "Pay Now" action (staff or customer) that places a wallet hold.
  let order;
  try {
    order = await db.transaction(async (tx) => {
      const created = await orderRepo.create(
        {
          userId: customerId,
          stateId: orderStateId,
          quantity: Number(quantity),
          price: serverPrice,
          totalPrice: String(totalAmount),
          productId,
          pfiId: null,
          releaseType: deliveryType,
          releaseStatus: "pending",
          orderType: "regular",
          deliveryAddress:
            deliveryType === "delivery" && typeof deliveryAddress === "string"
              ? deliveryAddress.trim()
              : null,
          customerName: `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || null,
          customerPhone: customer.phoneNumber || null,
          status: "pending",
          paidToAccountNumber: virtualAccountNumber,
          paidToBankName: virtualAccountBank,
          paidToAccountName: virtualAccountName,
          // Full key kept only in sman.order_idempotency (below), which is
          // what actually enforces uniqueness — this is a best-effort,
          // truncated copy so Django's own admin can see the fingerprint too.
          orderFingerprint: idempotencyKey ? String(idempotencyKey).slice(0, 64) : null,
          truckExited: false,
          truckEntered: false,
          overpaymentFlagged: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        tx
      );

      const movement = await pfiRepo.reserveStock(reservedPfi.id, reservedQuantity, created.id, tx);
      if (!movement) {
        throw httpError(
          400,
          `Insufficient stock in PFI ${reservedPfi.pfiNumber || reservedPfi.id} (may have been claimed by another order)`
        );
      }
      await pfiRepo.markFinishedIfComplete(reservedPfi.id, tx);
      await orderPfiAllocationRepo.create([{ pfiId: reservedPfi.id, quantity: reservedQuantity }], created.id, tx);

      const finalOrder = await orderRepo.update(created.id, { pfiId: reservedPfi.id }, tx);
      finalOrder.orderProductId = created.orderProductId;

      // A concurrent duplicate throws 23505 here; the outer catch below
      // recognises it via isIdempotencyConflict and replays the winner's
      // order instead of surfacing the error.
      if (idempotencyKey) {
        await tx.insert(orderIdempotency).values({ idempotencyKey: String(idempotencyKey), orderId: created.id });
      }

      await auditLogRepo.record(
        {
          entityType: "order",
          entityId: created.id,
          action: "order.created",
          actor,
          metadata: {
            deliveryType,
            quantity: Number(quantity),
            totalAmount: String(totalAmount),
          },
        },
        tx
      );

      // Pickup: materialise the customer's declared trucks as pending
      // consumer_truckallocation rows now, one per truck (plate + its
      // quantity), inside the same transaction — this IS the live model's
      // "created at order time" allocation (soroman_backend-2/consumer/
      // models.py's TruckAllocation), not a Sman-only concept. Gate-in/load/
      // gate-out tracking happens on a SEPARATE consumer_truckticket row
      // (generated later, see ticket.service.js/generateTicketForTruck),
      // not on this one. Delivery declares no trucks here (allocated at
      // release).
      for (let i = 0; i < declaredTrucks.length; i += 1) {
        const t = declaredTrucks[i];
        const truckNumber = i + 1;
        const load = await orderTruckRepo.create(
          {
            orderId: created.id,
            orderProductId: created.orderProductId,
            truckNumber,
            quantity: String(t.quantity),
            ticketNumber: truckAllocationTicketNumber(created.id, truckNumber),
            ticketStatus: "pending",
            driverName: t.driverName || null,
            plateNumber: t.truckNumber || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          tx
        );
        await auditLogRepo.record(
          {
            entityType: "order_truck",
            entityId: load.id,
            action: "order_truck.allocated",
            actor,
            metadata: { orderId: created.id, truckNumber, plateNumber: load.plateNumber, quantity: String(t.quantity), via: "pickup-declaration" },
          },
          tx
        );
      }

      return finalOrder;
    });
  } catch (err) {
    if (idempotencyKey && isIdempotencyConflict(err)) {
      const [existing] = await db
        .select({ orderId: orderIdempotency.orderId })
        .from(orderIdempotency)
        .where(eq(orderIdempotency.idempotencyKey, String(idempotencyKey)))
        .limit(1);
      if (existing) return replayResult(existing.orderId);
    }
    throw err;
  }

  const fullOrder = await orderRepo.findByIdFull(order.id);
  const reference = fullOrder.orderNumber;

  if (customer.email) {
    try {
      await sendOrderInvoiceEmail(customer.email, {
        orderNumber: reference,
        orderDate: order.createdAt,
        customerName: customer.name,
        companyName: customer.companyName,
        customerPhone: customer.phone,
        product: fullOrder.productName || "N/A",
        sku: fullOrder.productSku || "",
        quantity: order.quantity,
        unit: fullOrder.productUnit || "Liters",
        price: serverPrice,
        totalAmount: order.totalPrice,
        deliveryType: order.deliveryType,
        depotName: depot.name,
        depotCode: depot.code,
        state: fullOrder.stateName || "",
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
      orderNumber: reference,
      customerName: customer.name,
      product: fullOrder.productName || "N/A",
      quantity: order.quantity,
      unit: fullOrder.productUnit || "Liters",
      totalAmount: order.totalPrice,
      accountNumber: virtualAccountNumber,
      bankName: virtualAccountBank,
      accountName: virtualAccountName,
    });
    smsSent = smsResult.success;
    if (!smsSent) console.error("Failed to send order SMS:", smsResult.message);
  } catch (smsErr) {
    console.error("Failed to send order SMS:", smsErr.message);
  }

  // The invoice email and payment SMS above stay exactly as they are — they
  // are transactional documents whose layout and wording are the point. This
  // adds the inbox row and the push that were missing, so the order also shows
  // up in the app. The catalog entry is APP_ONLY for precisely that reason: it
  // must not re-send what the two calls above already sent.
  notify("order.created", {
    to: { customer },
    data: {
      orderId: order.id,
      orderNumber: reference,
      reference,
      customerName: customer.name,
      product: fullOrder.productName || "",
      quantity: order.quantity,
      unit: fullOrder.productUnit || "Liters",
      totalAmount: order.totalPrice,
      depotName: depot.name,
      deliveryType: order.deliveryType,
    },
  });

  // Sales and finance want to see the order land without watching the list.
  notify("staff.order_placed", {
    to: { roles: ["admin", "super_admin", "sales_manager", "finance_manager"] },
    data: {
      orderId: order.id,
      orderNumber: reference,
      reference,
      customerName: customer.name,
      product: fullOrder.productName || "",
      quantity: order.quantity,
      unit: fullOrder.productUnit || "Liters",
      totalAmount: order.totalPrice,
      depotName: depot.name,
    },
  });

  return {
    order: fullOrder,
    isPaidWithWallet: false,
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
 * Release reserved stock, delete truck loads, and release any wallet hold for
 * a cancelled or expired order. Shared by cancelOrder and expireOrder so the
 * restitution logic lives in one place.
 */
async function releaseOrderResources(order, tx) {
  // The live schema supports exactly one PFI per order (see placeOrder's
  // header note) — releaseStock(pfiId, orderId, tx) deletes the single
  // RELEASE movement row for this order directly, no per-allocation loop
  // needed anymore.
  if (order.pfiId) {
    await pfiRepo.releaseStock(order.pfiId, order.id, tx);
    await orderPfiAllocationRepo.deleteByOrderId(order.id, tx);
  }
  await orderTruckRepo.deleteByOrder(order.id, tx);
  await walletService.releaseHold(order.id, tx);
}

/**
 * Cancel a live order (any status through Released). One transaction: the
 * state machine locks the row and rejects an illegal or concurrent cancel
 * BEFORE any restitution, then stock release and the hold release run as the
 * same unit. Shared by the staff endpoint and the
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

    await releaseOrderResources(order, tx);

    return order;
  });
}

/**
 * Expire a single order: drive Pending→Expired (system actor) and return its
 * reserved stock, mirroring a cancel minus the human. The
 * state machine only allows Expired from Pending, so a concurrently paid or
 * cancelled order throws 409 here and is skipped by the sweep. Joins an existing
 * transaction when one is passed (the pre-payment guard).
 */
async function expireOrder(orderId, { tx } = {}) {
  const run = async (tx) => {
    const order = await orderStatus.transition(orderId, "Expired", {
      tx,
      actor: { type: "system" },
      action: "order.expired",
      set: { expiredAt: new Date() },
      metadata: { reason: "unpaid past expiry window", expiryHours: orderExpiryHours() },
    });

    await releaseOrderResources(order, tx);

    return order;
  };
  return tx ? run(tx) : db.transaction(run);
}

/**
 * The expiry sweep: lapse every Pending, unpaid order older than the window
 * (ORDER_EXPIRY_HOURS). Run on a schedule (POST /api/order-expiry/run). A row
 * that a concurrent pay/cancel already moved throws inside expireOrder and is
 * skipped — one stale order never fails the whole sweep.
 *
 * @returns {number} how many orders were expired
 */
async function expireStaleOrders() {
  const cutoff = new Date(Date.now() - orderExpiryMs());
  const stale = await orderRepo.findStalePending(cutoff);

  let expired = 0;
  for (const row of stale) {
    try {
      const order = await expireOrder(row.id);
      expired += 1;
      await notifyOrderExpired(order);
    } catch (err) {
      console.error(`[expiry] order ${row.orderNumber} (#${row.id}) skipped:`, err.message);
    }
  }

  console.log(`[expiry] considered ${stale.length} stale order(s); expired ${expired}`);
  return expired;
}

/**
 * Tell the customer their order lapsed — best-effort, never fails the sweep. The
 * order got an SMS at placement; this closes the loop so a lapsed order isn't
 * silent. The customer is unpaid, so there's nothing to refund.
 */
async function notifyOrderExpired(order) {
  try {
    const customer = await customerRepo.findById(order.customerId);
    if (customer?.phone) {
      await sendOrderExpiredSMS(customer.phone, {
        orderNumber: order.orderNumber,
        customerName: customer.name,
      });
    }
    // The SMS above is unchanged; this adds the inbox row so a customer who
    // opens the app days later still finds out why the order vanished.
    if (customer) {
      notify("order.expired", {
        to: { customer },
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          reference: order.orderNumber,
          customerName: customer.name,
        },
      });
    }
  } catch (err) {
    console.error(`[expiry] failed to notify customer for ${order.orderNumber}:`, err.message);
  }
}

/**
 * Replace the pickup truck declaration on an existing order (customer portal).
 * Writes to `order_trucks` only — tickets are issued later at load and are
 * never touched here.
 *
 * Editable while the order is Pending / Paid / Released and every existing
 * load is still `pending`. Once a load has been ticketed or gated, the customer
 * can no longer change the declaration (staff corrects at the gate/ticketing).
 *
 * @param {object} input
 * @param {number} input.orderId
 * @param {number} input.customerId — ownership check
 * @param {Array<{truckNumber?: string, quantity: number, driverName?: string, driverPhone?: string}>} input.trucks
 * @param {{type: "customer"|"staff"|"system", customerId?: number, staffId?: number}} input.actor
 * @param {string|null} [input.ipAddress]
 * @param {string|null} [input.userAgent]
 */
async function updatePickupTrucks({
  orderId,
  customerId,
  trucks,
  actor,
  ipAddress = null,
  userAgent = null,
}) {
  const declared = Array.isArray(trucks) ? trucks : [];

  return db.transaction(async (tx) => {
    const order = await orderRepo.lockById(orderId, tx);
    if (!order || order.customerId !== customerId) {
      throw httpError(404, "Order not found");
    }
    if (order.deliveryType !== "pickup") {
      throw httpError(400, "Only pickup orders carry customer-declared trucks");
    }

    const EDITABLE = new Set(["Pending", "Paid", "Released"]);
    if (!EDITABLE.has(order.status)) {
      throw httpError(
        409,
        `Order is ${order.status}; truck details can only be changed before loading starts`
      );
    }

    // Anything past `pending` has been ticketed or gated, and the declaration
    // is no longer the customer's to rewrite — the ticket already names a plate,
    // and deleting the load below would take that ticket with it.
    const existing = await orderTruckRepo.findByOrder(order.id, tx);
    const locked = existing.find((l) => l.ticketStatus !== "pending");
    if (locked) {
      throw httpError(
        409,
        "A ticket has already been issued for this order — truck details can no longer be changed here"
      );
    }

    const qty = Number(order.quantity);
    // Empty clears the declaration (gate captures trucks later). A non-empty
    // split must still sum to the order and stay within one tanker per truck.
    if (declared.length) {
      const sum = declared.reduce((s, t) => s + Number(t.quantity), 0);
      if (sum !== qty) {
        throw httpError(
          400,
          `The truck quantities (${sum.toLocaleString()} L) must sum to the order quantity (${qty.toLocaleString()} L)`
        );
      }
      const tooBig = declared.find((t) => Number(t.quantity) > 60000);
      if (tooBig) {
        throw httpError(400, "Each truck can carry at most 60,000 L — split the load across more trucks");
      }
    }

    await orderTruckRepo.deleteByOrder(order.id, tx);

    const orderProductId = await orderRepo.getLineItemId(order.id, tx);
    const loads = [];
    for (let i = 0; i < declared.length; i += 1) {
      const t = declared[i];
      const truckNumber = i + 1;
      const load = await orderTruckRepo.create(
        {
          orderId: order.id,
          orderProductId,
          truckNumber,
          quantity: String(t.quantity),
          ticketNumber: truckAllocationTicketNumber(order.id, truckNumber),
          ticketStatus: "pending",
          driverName: t.driverName || null,
          plateNumber: t.truckNumber || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        tx
      );
      await auditLogRepo.record(
        {
          entityType: "order_truck",
          entityId: load.id,
          action: "order_truck.allocated",
          actor,
          metadata: {
            orderId: order.id,
            truckNumber,
            plateNumber: load.plateNumber,
            quantity: String(t.quantity),
            via: "customer-update",
          },
          ipAddress,
          userAgent,
        },
        tx
      );
      loads.push(load);
    }

    await auditLogRepo.record(
      {
        entityType: "order",
        entityId: order.id,
        action: "order.trucks_updated",
        actor,
        metadata: {
          truckCount: loads.length,
          replaced: existing.length,
        },
        ipAddress,
        userAgent,
      },
      tx
    );

    return { order, trucks: loads };
  });
}

/**
 * If the order has lapsed, expire it now in its own committed transaction,
 * scoped to the caller. Runs before a payment attempt so paying a stale order
 * flags it Expired first (that flag survives) and the payment is then refused —
 * rather than settling an order at a price that is no longer current. A foreign
 * order, or one a concurrent action already moved, is left untouched.
 *
 * @returns {boolean} whether it expired the order
 */
async function expireIfStale({ orderId, customerId = null }) {
  return db.transaction(async (tx) => {
    const order = await orderRepo.lockById(orderId, tx);
    if (!order) return false;
    if (customerId != null && order.customerId !== customerId) return false;
    if (!isOrderExpired(order)) return false;
    await expireOrder(orderId, { tx });
    return true;
  });
}

/**
 * The side effects that must follow a confirmed payment: the loading ticket,
 * the commission record, and the WhatsApp payment-confirmed push. Runs
 * post-commit (the money is already durable) and NEVER throws — each failure is
 * logged with a `[post-payment]` marker for alerting.
 *
 * Idempotent: the ticket and commission each no-op if they already exist, so a
 * failed effect can be healed by re-running this — at pay time, or via the
 * finance reconcile endpoint — without duplicating anything.
 *
 * @returns {{ticket: boolean, commission: boolean}} what succeeded this run
 */
async function runPostPaymentEffects(orderId, { notifyWhatsApp = true } = {}) {
  let ticket = false;
  let commission = false;
  let subaccountTransfer = null;

  try {
    await generateTicketForOrder(orderId);
    ticket = true;
  } catch (err) {
    console.error(`[post-payment] ticket failed for order ${orderId}:`, err.message);
  }

  try {
    await commissionService.createForOrder(orderId);
    commission = true;
  } catch (err) {
    console.error(`[post-payment] commission failed for order ${orderId}:`, err.message);
  }

  // Paystack auto-split transfer (disabled — manual deposit only): the
  // customer now pays straight into the depot's own bank account, so there
  // is no merchant-balance share left to push out. Re-add the import at the
  // top of this file to reinstate:
  // try {
  //   const orderForTransfer = await orderRepo.findByIdFull(orderId);
  //   if (orderForTransfer) {
  //     subaccountTransfer = await transferToDepotSubaccount(orderForTransfer);
  //   }
  // } catch (err) {
  //   console.error(`[post-payment] subaccount transfer failed for order ${orderId}:`, err.message);
  // }

  // Skipped when the caller already delivers the confirmation itself — the
  // WhatsApp engine replies "Payment received" synchronously in the same turn,
  // so the async push would be a duplicate.
  if (notifyWhatsApp) notifyWhatsAppPaymentConfirmed(orderId);

  return { ticket, commission, subaccountTransfer };
}

/**
 * Pay an unpaid order from the customer's wallet balance.
 *
 * Places a wallet hold, transitions Pending→Paid, generates a loading ticket,
 * and creates a commission record — all in one transaction. Triggered either by
 * staff (finance) or by the order's own customer from the portal.
 *
 * @param {object} opts
 * @param {number} opts.orderId
 * @param {number} [opts.customerId]  When set, an ownership guard: the order
 *   must belong to this customer or the call 404s. Omitted for staff, who may
 *   pay any order.
 * @param {{ type: string, staffId?: number, customerId?: number }} opts.actor
 * @returns {object} the updated order
 */
async function payOrder({ orderId, customerId = null, actor, notifyWhatsApp = true }) {
  // Lapsed orders are expired-and-refused, never paid at a stale price. The
  // guard commits the Expired flag first; the transaction below then sees it.
  await expireIfStale({ orderId, customerId });

  return db.transaction(async (tx) => {
    // orderRepo.lockById (not a raw select) so the row comes back through
    // formatOrderRow's translation — status/paymentStatus in Sman
    // vocabulary, customerId aliased from userId, totalAmount from
    // totalPrice. A raw select here previously read Django's live
    // lowercase status directly ("pending" !== "Pending"), which made
    // every payment attempt fail this function's own status check.
    const order = await orderRepo.lockById(orderId, tx);

    if (!order) throw httpError(404, "Order not found");
    // Customer-initiated payment may only ever touch the caller's OWN order; a
    // foreign order reads as a flat 404, never confirmed. Checked under the row
    // lock so it holds even against a concurrent change.
    if (customerId != null && order.customerId !== customerId) {
      throw httpError(404, "Order not found");
    }
    if (order.paymentStatus === "Paid") throw httpError(409, "Order is already paid");
    if (order.status === "Expired") {
      throw httpError(409, "This order has expired. Please place a new order at current prices.");
    }
    if (order.status !== "Pending") throw httpError(409, `Cannot pay an order in ${order.status} status`);

    const customer = await customerRepo.findById(order.customerId);
    if (!customer) throw httpError(404, "Customer not found");

    const orderTotal = Number(order.totalPrice);
    if (orderTotal <= 0) throw httpError(400, "Order total is invalid");

    const holdResult = await walletService.placeHold(
      {
        customerId: customer.id,
        orderId: order.id,
        amount: orderTotal,
        description: `Payment for Order ${order.orderNumber} (Wallet Balance)`,
      },
      tx
    );

    if (!holdResult.success) {
      if (holdResult.insufficient) {
        // consumer_customer has no balance column — computed from the sman
        // wallet ledger, same as everywhere else (see wallet.service.js).
        const available = await customerRepo.getBalance(customer.id, tx);
        throw httpError(400, `Insufficient wallet balance. Required: ₦${orderTotal.toLocaleString()}, Available: ₦${Number(available).toLocaleString()}`);
      }
      if (holdResult.alreadyHeld) {
        throw httpError(409, "A payment hold already exists for this order");
      }
      throw httpError(400, holdResult.message || "Payment failed");
    }

    await orderStatus.transition(order.id, "Paid", {
      tx,
      actor,
      action: "order.paid",
      // No live paymentStatus column — status/release_status alone carry
      // this now (see utils/orderStatusMapping.js).
      set: { paymentConfirmedAt: new Date().toISOString() },
      metadata: { via: "wallet", amount: String(orderTotal) },
    });

    // Payment IS the release: the order goes straight onto the ticketing desk
    // rather than waiting for someone to click a button that has no other
    // condition attached to it.
    await orderStatus.releaseOnPayment(order.id, { tx, actor, metadata: { via: "wallet" } });

    return order;
  }).then(async (order) => {
    await runPostPaymentEffects(order.id, { notifyWhatsApp });

    const fullOrder = await orderRepo.findByIdFull(order.id);
    return fullOrder;
  });
}

module.exports = {
  placeOrder,
  cancelOrder,
  updatePickupTrucks,
  payOrder,
  runPostPaymentEffects,
  expireOrder,
  expireIfStale,
  expireStaleOrders,
  isOrderExpired,
  computeExpiresAt,
  withExpiresAt,
  orderExpiryHours,
  httpError,
};
