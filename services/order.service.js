const { v4: uuidv4 } = require("uuid");
const { eq } = require("drizzle-orm");
const { db } = require("../config/db");
const { orders } = require("../db/schema");
const {
  orderRepo,
  customerRepo,
  depotRepo,
  productRepo,
  pfiRepo,
  orderTruckRepo,
  orderPfiAllocationRepo,
  auditLogRepo,
} = require("../repositories");
const walletService = require("./wallet.service");
const { createDedicatedAccount, transferToDepotSubaccount, switchCustomerDvaToSubaccount } = require("./payment.service");
const { sendOrderInvoiceEmail } = require("./email.service");
const { sendOrderSummarySMS, sendOrderExpiredSMS } = require("./sms.service");
const { notify } = require("../notifications");
const { findPfiForOrder } = require("./pfi.service");
const { generateTicketForOrder } = require("./ticket.service");
const orderStatus = require("./orderStatus.service");
const { getCustomerInitials } = require("../utils/helpers");
const commissionService = require("./commission.service");
const { QUEUES, enqueue } = require("../config/queue");

const notifyWhatsAppPaymentConfirmed = (orderId) => {
  if (process.env.WHATSAPP_ENABLED !== "true") return;
  enqueue(QUEUES.WA_EVENTS, { type: "payment_confirmed", orderId }).catch((err) =>
    console.error("[wa] payment-confirmed enqueue failed:", err.message)
  );
};

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// How long an unpaid order may sit before the sweep expires it. Read lazily (not
// captured at module load) so deployments — and tests — can tune it per run.
const orderExpiryHours = () => Number(process.env.ORDER_EXPIRY_HOURS) || 24;
const orderExpiryMs = () => orderExpiryHours() * 60 * 60 * 1000;

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
 * customer's own id. Everything else — server-side pricing, the dedicated
 * virtual account, the single atomic reserve→debit→create→ledger
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

  // Automatically switch customer DVA to depot Paystack Subaccount
  const depotSubaccountCode = depot.paystackSubaccountCode || depot.paystack_subaccount_code;
  if (virtualAccountNumber && depotSubaccountCode) {
    try {
      await switchCustomerDvaToSubaccount({
        accountNumber: virtualAccountNumber,
        subaccountCode: depotSubaccountCode,
      });
      await customerRepo.update(customerId, { dvaSubaccountCode: depotSubaccountCode });
    } catch (dvaErr) {
      console.error(`[placeOrder] Failed to switch DVA to subaccount for depot ${depotId}:`, dvaErr.message);
    }
  }

  const product = await productRepo.findById(productId);
  if (!product) {
    throw httpError(404, "Product not found");
  }
  const productUnit = product.unit || "Liters";

  // Server-side pricing — the client never supplies price/total.
  const priceEntry = await depotRepo.getProductPrice(depotId, productId);
  if (!priceEntry || Number(priceEntry.currentPrice) <= 0) {
    throw httpError(400, "No price configured for this product at this depot");
  }
  const serverPrice = Number(priceEntry.currentPrice);
  const totalAmount = serverPrice * Number(quantity);

  const { allocations, totalAvailableStock } = await findPfiForOrder(
    depotId,
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
  // several — required once the order exceeds one tanker (60,000 L). They set
  // the quantity per truck here; the plate is optional (it can be filled or
  // corrected at the gate and at ticketing). Delivery orders never carry trucks
  // at order time — their fleet is allocated at release.
  //
  // The desk is exempt: it places orders FOR a customer and can book any pickup
  // quantity as a single order — security still captures each arriving truck at
  // the gate. Self-service pickups (customer portal / WhatsApp) must declare the
  // split up front, so the requirement above is enforced only for them.
  const declaredTrucks = Array.isArray(trucks) ? trucks : [];
  if (deliveryType === "delivery" && declaredTrucks.length) {
    throw httpError(400, "Delivery trucks are allocated at release, not at order");
  }
  const isStaffOrder = actor?.type === "staff";
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
    } else if (Number(quantity) > 60000 && !isStaffOrder) {
      throw httpError(
        400,
        "A pickup over 60,000 L must be split across trucks — declare each truck and its quantity"
      );
    }
  }

  const orderNumber = `ORD-${uuidv4().replace(/-/g, "").slice(0, 12).toUpperCase()}`;

  // --- Atomic order creation -------------------------------------------------
  // Stock reservation, the order row and the declared pickup loads are ONE
  // unit: a failure anywhere rolls all of it back. Orders
  // are always created Unpaid — payment happens later via a manual "Pay Now"
  // action (staff or customer) that places a wallet hold.
  let order;
  try {
    ({ order } = await db.transaction(async (tx) => {
    // Reserve stock from each PFI in the allocation list. If any PFI runs
    // out concurrently the transaction rolls back — no partial reservations.
    const reservedPfis = [];
    for (const alloc of allocations) {
      const updatedPfi = await pfiRepo.reserveStock(alloc.pfi.id, alloc.quantity, tx);
      if (!updatedPfi) {
        throw httpError(
          400,
          `Insufficient stock in PFI ${alloc.pfi.pfiNumber || alloc.pfi.id} (may have been claimed by another order)`
        );
      }
      await pfiRepo.markFinishedIfComplete(updatedPfi.id, tx);
      reservedPfis.push({ pfiId: updatedPfi.id, quantity: alloc.quantity });
    }

    const created = await orderRepo.create(
      {
        orderNumber,
        customerId,
        state,
        depotId,
        productId,
        pfiId: reservedPfis[0].pfiId,
        quantity: Number(quantity),
        price: String(serverPrice),
        totalAmount: String(totalAmount),
        deliveryType,
        deliveryAddress:
          deliveryType === "delivery" && typeof deliveryAddress === "string"
            ? deliveryAddress.trim()
            : "",
        companyName: typeof companyName === "string" ? companyName.trim() : "",
        status: "Pending",
        paymentStatus: "Unpaid",
        virtualAccountNumber,
        virtualAccountBank,
        virtualAccountName,
        idempotencyKey,
      },
      tx
    );

    // Record per-PFI allocations so cancel/expire can release correctly.
    if (reservedPfis.length > 0) {
      await orderPfiAllocationRepo.create(reservedPfis, created.id, tx);
    }

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

    return { order: created };
    }));
  } catch (err) {
    if (idempotencyKey && isIdempotencyConflict(err)) {
      const existing = await orderRepo.findByIdempotencyKey(idempotencyKey);
      if (existing) return replayResult(existing.id);
    }
    throw err;
  }

  const fullOrder = await orderRepo.findByIdFull(order.id);

  // The reference every surface shows — "SO600", not the raw ORD-… column.
  //
  // `orderNumber` in this scope is the opaque internal value minted at line
  // ~305, before the row (and therefore its id) existed. It must never reach a
  // customer: the app, portal, admin dashboard and WhatsApp all render the
  // computed reference, so an invoice or SMS quoting ORD-BB464940706C names an
  // order the customer cannot find on any screen. findByIdFull() applies the
  // same decoration every other read path does.
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
      orderNumber: reference,
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
      totalAmount: order.totalAmount,
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
      totalAmount: order.totalAmount,
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
  if (order.pfiId) {
    const allocations = await orderPfiAllocationRepo.findByOrderId(order.id, tx);
    if (allocations.length > 0) {
      for (const alloc of allocations) {
        await pfiRepo.releaseStock(alloc.pfiId, alloc.quantity, tx);
      }
      await orderPfiAllocationRepo.deleteByOrderId(order.id, tx);
    } else {
      // Fallback for orders created before multi-PFI
      await pfiRepo.releaseStock(order.pfiId, order.quantity, tx);
    }
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
 * load is still `pending`. Once a truck has gated in, the customer can no
 * longer change the declaration (staff corrects at the gate / ticketing).
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

    const existing = await orderTruckRepo.findByOrder(order.id, tx);
    const locked = existing.find((l) => l.status !== "pending");
    if (locked) {
      throw httpError(
        409,
        "A truck has already arrived at the depot — truck details can no longer be changed here"
      );
    }

    const qty = Number(order.quantity);
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
    } else if (qty > 60000) {
      throw httpError(
        400,
        "A pickup over 60,000 L must be split across trucks — declare each truck and its quantity"
      );
    }

    await orderTruckRepo.deleteByOrder(order.id, tx);

    const loads = [];
    for (let i = 0; i < declared.length; i += 1) {
      const t = declared[i];
      const load = await orderTruckRepo.create(
        {
          orderId: order.id,
          truckIndex: i + 1,
          truckId: null,
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
          metadata: {
            orderId: order.id,
            truckIndex: i + 1,
            truckNumber: load.truckNumber,
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

  // Transfer depot share to subaccount (best-effort)
  try {
    const orderForTransfer = await orderRepo.findByIdFull(orderId);
    if (orderForTransfer) {
      subaccountTransfer = await transferToDepotSubaccount(orderForTransfer);
    }
  } catch (err) {
    console.error(`[post-payment] subaccount transfer failed for order ${orderId}:`, err.message);
  }

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
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update")
      .limit(1);

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

    const orderTotal = Number(order.totalAmount);
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
        throw httpError(400, `Insufficient wallet balance. Required: ₦${orderTotal.toLocaleString()}, Available: ₦${Number(customer.balance).toLocaleString()}`);
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
      set: { paymentConfirmedAt: new Date(), paymentStatus: "Paid" },
      metadata: { via: "wallet", amount: String(orderTotal) },
    });

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
  httpError,
};
