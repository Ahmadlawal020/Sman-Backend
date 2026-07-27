const asyncHandler = require("express-async-handler");
const {
  orderRepo,
  customerRepo,
  depotRepo,
  pfiRepo,
  depositRepo,
  truckRepo,
  orderTruckRepo,
} = require("../../repositories");
const { db } = require("../../config/db");
const { generateTicketForTruck } = require("../../services/ticket.service");
const orderStatus = require("../../services/orderStatus.service");
const { placeOrder } = require("../../services/order.service");

/** Small helper: an HTTP error the error handler renders with its status. */
function httpErr(status, message) {
  return Object.assign(new Error(message), { status });
}

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

// The desk places an order FOR a customer: the customer id comes from the
// request body. The shared placeOrder service does the real work; this handler
// only supplies who the customer is. See also the customer portal's
// createMyOrder, which passes the authenticated customer's own id.
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

  const { order, payment } = await placeOrder({
    customerId, state, depotId, productId, quantity, deliveryType,
  });

  res.status(201).json({
    success: true,
    message: "Order placed successfully",
    data: { order, payment },
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

// --- The truck gate flow ----------------------------------------------------
//
// Three physical checkpoints move a released order through loading:
//
//   gate-in  (security_entry)  pending  → gated_in   ; first truck ⇒ Released→Loading
//   load     (ticketing)       gated_in → loaded     ; issues the per-truck ticket
//   gate-out (security_exit)   loaded   → gated_out  ; last truck  ⇒ Loading→Completed
//
// Every action locks the ORDER row first (orderRepo.lockById), so concurrent
// trucks on the same order serialise: exactly one sees the "first in" / "last
// out" edge and drives the order transition; the others skip it. Each load's
// own status guard makes an out-of-order or repeated action a clean 409.

const GATEABLE = new Set(["Released", "Loading"]);

// security_entry: a truck arrives at the entrance gate to load.
const gateInTruck = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const { loadId, truckNumber, quantity, driverName, driverPhone, compartments } = req.body;
  const actor = { type: "staff", staffId: req.user.id };
  const audit = { ipAddress: req.ip, userAgent: req.headers["user-agent"] };

  const load = await db.transaction(async (tx) => {
    const order = await orderRepo.lockById(orderId, tx);
    if (!order) throw httpErr(404, "Order not found");
    if (!GATEABLE.has(order.status)) {
      throw httpErr(409, `Order is ${order.status}; it is not open for gating`);
    }

    let gated;
    if (order.deliveryType === "delivery") {
      // The truck was allocated at release — flip that specific load.
      if (loadId == null) throw httpErr(400, "loadId is required for a delivery order");
      const existing = await orderTruckRepo.findById(loadId, tx);
      if (!existing || existing.orderId !== orderId) throw httpErr(404, "Truck load not found on this order");
      if (existing.status !== "pending") {
        throw httpErr(409, `Truck is already ${existing.status}`);
      }
      gated = await orderTruckRepo.update(
        loadId,
        {
          status: "gated_in",
          securityEnteredAt: new Date(),
          securityEnteredBy: req.user.id,
          // Security may correct the driver actually present.
          ...(driverName != null ? { driverName } : {}),
          ...(driverPhone != null ? { driverPhone } : {}),
        },
        tx
      );
    } else {
      // Pickup: the customer's own truck is captured HERE, first time it is seen.
      if (!truckNumber || quantity == null) {
        throw httpErr(400, "A pickup gate-in needs the truck's plate (truckNumber) and quantity");
      }
      const index = (await orderTruckRepo.countByOrder(orderId, tx)) + 1;
      gated = await orderTruckRepo.create(
        {
          orderId,
          truckIndex: index,
          truckId: null,
          truckNumber,
          quantity: String(quantity),
          compartments: compartments ?? null,
          driverName: driverName ?? null,
          driverPhone: driverPhone ?? null,
          status: "gated_in",
          securityEnteredAt: new Date(),
          securityEnteredBy: req.user.id,
        },
        tx
      );
    }

    // First truck through the gate opens loading. Under the order lock, only the
    // first caller sees Released; a later truck sees Loading and skips this.
    if (order.status === "Released") {
      await orderStatus.transition(orderId, "Loading", {
        tx,
        actor,
        set: { loadingStartedAt: new Date() },
        metadata: { trigger: "gate-in", loadId: gated.id },
        ...audit,
      });
    }

    return gated;
  });

  res.json({ success: true, message: "Truck gated in", data: { truck: load } });
});

// ticketing: the truck has loaded; issue its ticket.
const markTruckLoaded = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const loadId = Number(req.params.loadId);

  const result = await db.transaction(async (tx) => {
    const order = await orderRepo.lockById(orderId, tx);
    if (!order) throw httpErr(404, "Order not found");

    const load = await orderTruckRepo.findById(loadId, tx);
    if (!load || load.orderId !== orderId) throw httpErr(404, "Truck load not found on this order");
    if (load.status !== "gated_in") {
      throw httpErr(409, `Truck is ${load.status}; only a gated-in truck can be marked loaded`);
    }

    const updated = await orderTruckRepo.update(
      loadId,
      { status: "loaded", loadedAt: new Date(), loadedBy: req.user.id },
      tx
    );
    const ticket = await generateTicketForTruck(order, updated, tx);
    return { truck: updated, ticket };
  });

  res.json({ success: true, message: "Truck loaded and ticket issued", data: result });
});

// security_exit: the loaded truck leaves the depot.
const gateOutTruck = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const loadId = Number(req.params.loadId);
  const actor = { type: "staff", staffId: req.user.id };
  const audit = { ipAddress: req.ip, userAgent: req.headers["user-agent"] };

  const result = await db.transaction(async (tx) => {
    const order = await orderRepo.lockById(orderId, tx);
    if (!order) throw httpErr(404, "Order not found");

    const load = await orderTruckRepo.findById(loadId, tx);
    if (!load || load.orderId !== orderId) throw httpErr(404, "Truck load not found on this order");
    if (load.status !== "loaded") {
      throw httpErr(409, `Truck is ${load.status}; only a loaded truck can be gated out`);
    }

    const updated = await orderTruckRepo.update(
      loadId,
      { status: "gated_out", securityExitedAt: new Date(), securityExitedBy: req.user.id },
      tx
    );

    // Last truck out completes the order. "Last" = no load remains in a
    // non-terminal state. Under the order lock this is race-free.
    let completed = false;
    const remaining = await orderTruckRepo.countByOrder(orderId, tx) -
      (await orderTruckRepo.countByOrderAndStatus(orderId, "gated_out", tx));
    if (remaining === 0 && order.status === "Loading") {
      await orderStatus.transition(orderId, "Completed", {
        tx,
        actor,
        set: { completedAt: new Date() },
        metadata: { trigger: "gate-out", loadId: updated.id },
        ...audit,
      });
      completed = true;
    }

    return { truck: updated, orderCompleted: completed };
  });

  res.json({
    success: true,
    message: result.orderCompleted ? "Truck gated out; order completed" : "Truck gated out",
    data: result,
  });
});

module.exports = {
  getOrders,
  getOrderById,
  createOrder,
  releaseOrder,
  cancelOrder,
  gateInTruck,
  markTruckLoaded,
  gateOutTruck,
};
