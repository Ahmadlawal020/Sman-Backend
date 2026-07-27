const asyncHandler = require("express-async-handler");
const { v4: uuidv4 } = require("uuid");
const {
  orderRepo,
  customerRepo,
  depotRepo,
  productRepo,
  pfiRepo,
  depositRepo,
  truckRepo,
  orderTruckRepo,
} = require("../../repositories");
const { db } = require("../../config/db");
const { createDedicatedAccount } = require("../../services/payment.service");
const { sendOrderInvoiceEmail } = require("../../services/email.service");
const { sendOrderSummarySMS } = require("../../services/sms.service");
const { findPfiForOrder } = require("../../services/pfi.service");
const { generateTicketForOrder } = require("../../services/ticket.service");
const { getCustomerInitials } = require("../../utils/helpers");
const orderStatus = require("../../services/orderStatus.service");

const getOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, search, status, customer, dateFrom, dateTo } = req.query;

  const result = await orderRepo.findAll({
    search,
    status,
    customer,
    dateFrom,
    dateTo,
    page,
    limit,
  });

  res.json({ success: true, data: result });
});

const getOrderById = asyncHandler(async (req, res) => {
  const order = await orderRepo.findByIdFull(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }

  res.json({ success: true, data: { order } });
});

const createOrder = asyncHandler(async (req, res) => {
  const {
    customer: customerId, state, depot: depotId,
    product: productId, quantity, deliveryType,
  } = req.body;

  if (!customerId || !state || !depotId || !productId || !quantity || !deliveryType) {
    return res.status(400).json({
      success: false,
      message: "Please fill in all required fields to place the order",
    });
  }

  const customer = await customerRepo.findById(customerId);
  if (!customer) {
    return res.status(404).json({ success: false, message: "Customer not found" });
  }

  // Ensure customer has a dedicated virtual account
  let virtualAccountNumber = customer.virtualAccountNumber || "";
  let virtualAccountBank = customer.virtualAccountBank || "";
  let virtualAccountName = customer.virtualAccountName || "";

  if (!virtualAccountNumber) {
    const accountResult = await createDedicatedAccount(customer);
    if (accountResult.success) {
      virtualAccountNumber = accountResult.data.accountNumber;
      virtualAccountBank = accountResult.data.bankName;
      virtualAccountName = accountResult.data.accountName || `SOROMANNIGERI/ ${getCustomerInitials(customer.name)}`;
      const updateData = {
        virtualAccountNumber,
        virtualAccountBank,
        virtualAccountName,
      };
      if (accountResult.data.paystackCustomerId) {
        updateData.paystackCustomerId = accountResult.data.paystackCustomerId;
      }
      await customerRepo.update(customerId, updateData);
    } else {
      return res.status(400).json({
        success: false,
        message: "Customer has no dedicated payment account and one could not be generated. Please try again or contact support.",
      });
    }
  } else if (!virtualAccountName) {
    virtualAccountName = `SOROMANNIGERI/ ${getCustomerInitials(customer.name)}`;
    await customerRepo.update(customerId, { virtualAccountName });
  }

  const depot = await depotRepo.findById(depotId);
  if (!depot) {
    return res.status(404).json({ success: false, message: "Depot not found" });
  }

  // Server-side pricing
  const priceEntry = await depotRepo.getProductPrice(depotId, productId);
  if (!priceEntry || Number(priceEntry.currentPrice) <= 0) {
    return res.status(400).json({
      success: false,
      message: "No price configured for this product at this depot",
    });
  }

  const serverPrice = Number(priceEntry.currentPrice);
  const totalAmount = serverPrice * Number(quantity);

  // Find active PFIs
  const { selectedPfi: pfiDoc, totalAvailableStock } = await findPfiForOrder(depotId, productId, quantity);

  if (!pfiDoc) {
    if (totalAvailableStock < Number(quantity)) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock in depot. Total active PFI stock: ${totalAvailableStock.toLocaleString()} Litres`,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock in any single active PFI. Maximum available in a single PFI is less than the requested ${Number(quantity).toLocaleString()} Litres`,
      });
    }
  }

  const orderNumber = `ORD-${uuidv4().replace(/-/g, "").slice(0, 12).toUpperCase()}`;

  // --- Atomic order creation (AUDIT H2) --------------------------------------
  //
  // Stock reservation, the wallet debit, the order row, its ledger entry and
  // the capacity change are ONE unit: a failure anywhere rolls all of it back.
  // Before this, a crash mid-way permanently burnt PFI stock or produced an
  // order with no ledger row. External work (DVA creation, email, SMS) stays
  // OUTSIDE the transaction — a DB transaction must never be held open across
  // an HTTP call.
  //
  // A guarded write returning null (stock claimed, funds gone) means a lost
  // race: throw a { status: 400 } error, which rolls the transaction back and
  // the error handler renders as a clean 400 with this message.
  const { order, isPaidWithWallet } = await db.transaction(async (tx) => {
    const updatedPfi = await pfiRepo.reserveStock(pfiDoc.id, Number(quantity), tx);
    if (!updatedPfi) {
      throw Object.assign(
        new Error("Insufficient stock in the selected PFI (may have been claimed by another order)"),
        { status: 400 }
      );
    }
    await pfiRepo.markFinishedIfComplete(updatedPfi.id, tx);

    // Decide the wallet payment by attempting the guarded debit FIRST, so the
    // order is created with a payment status that is already true — no
    // create-then-downgrade dance, and no window where the row says Paid
    // before the money is taken. debitBalance returns null if the funds are
    // gone (a concurrent order spent them), in which case the order is Unpaid.
    let paid = false;
    let debited = null;
    if (Number(customer.balance || 0) >= totalAmount) {
      debited = await customerRepo.debitBalance(customerId, totalAmount, tx);
      paid = Boolean(debited);
    }

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
        paymentStatus: paid ? "Paid" : "Unpaid",
        virtualAccountNumber,
        virtualAccountBank,
        virtualAccountName,
      },
      tx
    );

    // Ledger row — now INSIDE the transaction (AUDIT H6). Previously this was a
    // try/catch that only console.error'd, so money could move with no audit
    // row. Here a failed ledger write rolls the debit and the order back.
    if (paid) {
      await depositRepo.create(
        {
          customerId,
          amount: String(totalAmount),
          type: "debit",
          description: `Payment for Order ${orderNumber} (Wallet Balance)`,
          balanceAfter: String(debited.balance),
        },
        tx
      );
    }

    await depotRepo.decrementProductCapacity(depotId, productId, Number(quantity), tx);

    return { order: created, isPaidWithWallet: paid };
  });

  // --- Post-commit side effects. The order is durable; these are best-effort.
  // Generate the loading ticket if the wallet paid immediately.
  if (isPaidWithWallet) {
    try {
      await generateTicketForOrder(order.id);
    } catch (ticketErr) {
      console.error("Failed to generate ticket on instant wallet payment:", ticketErr.message);
    }
  }

  // Populate for response
  const fullOrder = await orderRepo.findByIdFull(order.id);

  // Send invoice email
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

  // Send SMS
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

  res.status(201).json({
    success: true,
    message: "Order placed successfully",
    data: {
      order: fullOrder,
      payment: {
        accountNumber: virtualAccountNumber,
        bankName: virtualAccountBank,
        accountName: virtualAccountName,
        emailSent: !!customer.email,
        smsSent,
      },
    },
  });
});

// --- Release: Paid → Released ------------------------------------------------
//
// The raw `PUT /orders/:id` status setter (updateOrder) and the manual
// `POST /:id/complete` setter are GONE (AUDIT H1). They let any caller stamp
// any status, skipping the pipeline and leaving no audit row. Every status
// change now flows through orderStatus.transition — the single writer that
// locks the row, enforces the legal move and writes the audit trail atomically.
//
// Release is a staff action ("release" role): it clears a paid order for
// loading. The fleet-truck allocation is captured HERE for a delivery order —
// the plate/driver of each Soroman truck sent to load — and the loads are
// created in the same transaction as the transition, so a bad allocation rolls
// the release back. A pickup order carries no trucks at release: the customer's
// own truck is captured by security at gate-in (see the gate flow).
const releaseOrder = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const trucks = req.body.trucks || [];

  const order = await orderRepo.findById(orderId);
  if (!order) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }

  const isDelivery = order.deliveryType === "delivery";
  if (isDelivery) {
    if (trucks.length === 0) {
      return res.status(400).json({
        success: false,
        message: "A delivery order needs at least one truck allocated at release",
      });
    }
    // The loads must account for exactly the order quantity — no over- or
    // under-allocation. Compared as numbers; the schema already coerced them.
    const allocated = trucks.reduce((sum, t) => sum + Number(t.quantity), 0);
    if (allocated !== Number(order.quantity)) {
      return res.status(400).json({
        success: false,
        message: `Allocated truck quantity (${allocated}) must equal the order quantity (${order.quantity})`,
      });
    }
  } else if (trucks.length > 0) {
    return res.status(400).json({
      success: false,
      message: "Pickup trucks are captured by security at the gate, not at release",
    });
  }

  const released = await db.transaction(async (tx) => {
    const updated = await orderStatus.transition(orderId, "Released", {
      tx,
      actor: { type: "staff", staffId: req.user.id },
      set: { releasedAt: new Date(), releasedBy: req.user.id },
      metadata: { truckCount: isDelivery ? trucks.length : 0 },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    if (isDelivery) {
      let index = 1;
      for (const t of trucks) {
        // A fleet truck contributes its registered plate; the stored plate is
        // still the source of truth, so a later fleet edit never rewrites this
        // historical load.
        let truckNumber = t.truckNumber || null;
        if (t.truckId != null) {
          const fleet = await truckRepo.findById(t.truckId);
          if (!fleet) {
            throw Object.assign(new Error(`Fleet truck ${t.truckId} not found`), { status: 400 });
          }
          truckNumber = truckNumber || fleet.plateNumber;
        }

        await orderTruckRepo.create(
          {
            orderId,
            truckIndex: index++,
            truckId: t.truckId ?? null,
            truckNumber,
            quantity: String(t.quantity),
            compartments: t.compartments ?? null,
            driverName: t.driverName ?? null,
            driverPhone: t.driverPhone ?? null,
            loaderName: t.loaderName ?? null,
            loaderPhone: t.loaderPhone ?? null,
            status: "pending",
          },
          tx
        );
      }
    }

    return updated;
  });

  const fullOrder = await orderRepo.findByIdFull(released.id);
  const loads = await orderTruckRepo.findByOrder(orderId);
  res.json({
    success: true,
    message: "Order released for loading",
    data: { order: fullOrder, trucks: loads },
  });
});

// --- Cancel: any live status through Released → Cancelled --------------------
//
// The status change now goes through the state machine FIRST (inside the same
// transaction): it locks the row, rejects an illegal move (Loading/Completed →
// 409) or a concurrent double-cancel (the loser gets 409 before any refund),
// and writes the audit row. Only then do stock release, capacity restore and
// the refund + its ledger row run — all one unit, so a failure anywhere rolls
// the whole cancel back (AUDIT H2/H6), and no order is ever refunded twice.
const cancelOrder = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  await db.transaction(async (tx) => {
    const order = await orderStatus.transition(Number(req.params.id), "Cancelled", {
      tx,
      actor: { type: "staff", staffId: req.user.id },
      set: {
        cancelledAt: new Date(),
        cancelledBy: req.user.id,
        cancellationReason: reason ?? null,
      },
      metadata: { reason: reason ?? null, refunded: false },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    if (order.pfiId) {
      await pfiRepo.releaseStock(order.pfiId, order.quantity, tx);
    }
    await depotRepo.incrementProductCapacity(order.depotId, order.productId, order.quantity, tx);

    if (order.paymentStatus === "Paid") {
      const credited = await customerRepo.creditBalance(
        order.customerId,
        Number(order.totalAmount),
        tx
      );
      await depositRepo.create(
        {
          customerId: order.customerId,
          amount: String(order.totalAmount),
          type: "credit",
          description: `Refund for cancelled Order ${order.orderNumber}`,
          balanceAfter: String(credited.balance),
        },
        tx
      );
    }
  });

  const updatedOrder = await orderRepo.findByIdFull(Number(req.params.id));
  res.json({ success: true, message: "Order cancelled successfully", data: { order: updatedOrder } });
});

module.exports = {
  getOrders,
  getOrderById,
  createOrder,
  releaseOrder,
  cancelOrder,
};
