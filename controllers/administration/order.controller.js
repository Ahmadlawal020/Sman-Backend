const asyncHandler = require("express-async-handler");
const {
  orderRepo,
  depotRepo,
  pfiRepo,
  truckRepo,
  orderTruckRepo,
  auditLogRepo,
} = require("../../repositories");
const { db } = require("../../config/db");
const { pfiMovements } = require("../../db/schema");
const walletService = require("../../services/wallet.service");
const { generateTicketForTruck } = require("../../services/ticket.service");
const orderStatus = require("../../services/orderStatus.service");
const orderService = require("../../services/order.service");
const { placeOrder } = orderService;

/** Small helper: an HTTP error the error handler renders with its status. */
function httpErr(status, message) {
  return Object.assign(new Error(message), { status });
}

const getOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, search, status, customer, depot, dateFrom, dateTo } = req.query;

  const result = await orderRepo.findAll({
    search,
    status,
    customer,
    depot,
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
    product: productId, quantity, deliveryType, deliveryAddress, companyName, trucks,
  } = req.body;

  if (!customerId || !state || !depotId || !productId || !quantity || !deliveryType) {
    return res.status(400).json({
      success: false,
      message: "Please fill in all required fields to place the order",
    });
  }

  const { order, payment } = await placeOrder({
    customerId, state, depotId, productId, quantity, deliveryType, deliveryAddress, companyName, trucks,
    actor: { type: "staff", staffId: req.user.id },
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
      message: "Pickup trucks are declared by the customer at order, not at release",
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

        const load = await orderTruckRepo.create(
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
        await auditLogRepo.record(
          {
            entityType: "order_truck",
            entityId: load.id,
            action: "order_truck.allocated",
            actor: { type: "staff", staffId: req.user.id },
            metadata: { orderId, truckIndex: load.truckIndex, truckNumber, truckId: t.truckId ?? null, quantity: String(t.quantity), via: "release" },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
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

  await orderService.cancelOrder({
    orderId: Number(req.params.id),
    actor: { type: "staff", staffId: req.user.id },
    reason: reason ?? null,
    cancelledBy: req.user.id,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
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

/**
 * A caller-supplied gate timestamp, or now.
 *
 * Rejects anything unparseable rather than silently recording the current
 * time — a wrong gate time is worse than a refused one.
 */
function parseWhen(value) {
  if (!value) return new Date();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw httpErr(400, "Timestamp must be a valid ISO 8601 datetime");
  }
  return d;
}

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
    if (loadId != null) {
      // A load already exists — a delivery truck allocated at release, or a
      // pickup truck the customer declared at order. Flip that specific one.
      const existing = await orderTruckRepo.findById(loadId, tx);
      if (!existing || existing.orderId !== orderId) throw httpErr(404, "Truck load not found on this order");
      // Idempotent: a second entry reports the first rather than
      // overwriting the original timestamp.
      if (existing.status !== "pending") {
        return { load: existing, alreadyEntered: true };
      }
      // The truck that actually arrived may differ from the one declared (a
      // pickup swap, or an unknown plate now known). Record the correction.
      // optionalString yields "" for an omitted field — treat that as "not
      // provided" so a blank body never wipes the declared plate/driver.
      const plateChanged = Boolean(truckNumber) && truckNumber !== existing.truckNumber;
      gated = await orderTruckRepo.update(
        loadId,
        {
          status: "gated_in",
          securityEnteredAt: parseWhen(req.body.enteredAt),
          securityEnteredBy: req.user.id,
          ...(truckNumber ? { truckNumber } : {}),
          // The driver observed at the gate is recorded alongside — never over
          // — the one booked at generation. The truck that turns up is not
          // always the one booked, and both facts matter afterwards.
          ...(driverName ? { entryDriverName: driverName } : {}),
          ...(driverPhone ? { entryDriverPhone: driverPhone } : {}),
        },
        tx
      );
      if (plateChanged) {
        await auditLogRepo.record(
          {
            entityType: "order_truck",
            entityId: loadId,
            action: "order_truck.plate_corrected",
            actor,
            metadata: { from: existing.truckNumber, to: truckNumber, at: "gate-in", orderId },
            ...audit,
          },
          tx
        );
      }
    } else if (order.deliveryType === "pickup") {
      // No pre-declared load (a small pickup that didn't split up front): the
      // customer's truck is captured HERE, the first time it is seen.
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
          securityEnteredAt: parseWhen(req.body.enteredAt),
          securityEnteredBy: req.user.id,
        },
        tx
      );
    } else {
      throw httpErr(400, "loadId is required for a delivery order");
    }

    await auditLogRepo.record(
      {
        entityType: "order_truck",
        entityId: gated.id,
        action: "order_truck.gated_in",
        actor,
        metadata: { orderId, truckNumber: gated.truckNumber },
        ...audit,
      },
      tx
    );

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

// ticketing: the truck has loaded; issue its ticket. This is the LAST moment
// the plate can change — trucks get swapped at the gantry (the declared one
// broke down, another came), and the ticket must name the truck that actually
// loaded. An optional truckNumber/driver here records that actual truck; the
// change is audited and the ticket is generated from the corrected load.
const markTruckLoaded = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const loadId = Number(req.params.loadId);
  const { truckNumber, driverName, driverPhone } = req.body;
  const actor = { type: "staff", staffId: req.user.id };
  const audit = { ipAddress: req.ip, userAgent: req.headers["user-agent"] };

  const result = await db.transaction(async (tx) => {
    const order = await orderRepo.lockById(orderId, tx);
    if (!order) throw httpErr(404, "Order not found");

    const load = await orderTruckRepo.findById(loadId, tx);
    if (!load || load.orderId !== orderId) throw httpErr(404, "Truck load not found on this order");
    if (load.status !== "gated_in") {
      throw httpErr(409, `Truck is ${load.status}; only a gated-in truck can be marked loaded`);
    }

    // optionalString yields "" for an omitted field — treat that as "not
    // provided" so loading without an edit keeps the plate already on the load.
    const plateChanged = Boolean(truckNumber) && truckNumber !== load.truckNumber;
    const updated = await orderTruckRepo.update(
      loadId,
      {
        status: "loaded",
        loadedAt: new Date(),
        loadedBy: req.user.id,
        ...(truckNumber ? { truckNumber } : {}),
        ...(driverName ? { driverName } : {}),
        ...(driverPhone ? { driverPhone } : {}),
      },
      tx
    );
    if (plateChanged) {
      await auditLogRepo.record(
        {
          entityType: "order_truck",
          entityId: loadId,
          action: "order_truck.truck_swapped",
          actor,
          metadata: { from: load.truckNumber, to: truckNumber, at: "loading", orderId },
          ...audit,
        },
        tx
      );
    }
    await auditLogRepo.record(
      {
        entityType: "order_truck",
        entityId: loadId,
        action: "order_truck.loaded",
        actor,
        metadata: { orderId, truckNumber: updated.truckNumber },
        ...audit,
      },
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
    // Idempotent: a second exit reports the first rather than overwriting it.
    if (load.status === "gated_out") {
      return { load, alreadyExited: true };
    }
    // The ordering rule: a truck that never arrived cannot leave.
    if (load.status === "pending") {
      throw httpErr(409, "Truck must be marked as entered before it can exit");
    }

    const updated = await orderTruckRepo.update(
      loadId,
      {
        status: "gated_out",
        securityExitedAt: parseWhen(req.body.exitedAt),
        securityExitedBy: req.user.id,
        // Gantry the truck loaded from and the loader on duty, per the
        // security handover record.
        ...(req.body.gantry ? { gantry: String(req.body.gantry).trim() } : {}),
        ...(req.body.loaderName ? { loaderName: String(req.body.loaderName).trim() } : {}),
      },
      tx
    );

    await auditLogRepo.record(
      {
        entityType: "order_truck",
        entityId: loadId,
        action: "order_truck.gated_out",
        actor,
        metadata: { orderId, truckNumber: updated.truckNumber },
        ...audit,
      },
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
      // The order is fulfilled — convert the wallet hold into a booked debit
      // ledger row (the spend is recorded only now, not at order time). An order
      // with no active hold (never wallet-funded) is a no-op.
      await walletService.convertHold(
        orderId,
        `Payment for Order ${order.orderNumber} (Wallet Balance)`,
        tx
      );
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

const getPayableOrders = asyncHandler(async (req, res) => {
  const orders = await orderRepo.findPayableOrders();
  res.json({ success: true, data: { orders } });
});

const payOrder = asyncHandler(async (req, res) => {
  const order = await orderService.payOrder({
    orderId: Number(req.params.id),
    actor: { type: "staff", staffId: req.user.id },
  });
  res.json({
    success: true,
    message: `Order ${order.orderNumber} paid successfully from wallet`,
    data: { order },
  });
});

/** Per-truck ceiling, matching the limit order.service enforces at creation. */
const MAX_TRUCK_LITRES = 60000;
/** Tickets may only be generated once the order has been released. */
const TICKETABLE = new Set(["Released", "Loading"]);

/**
 * POST /:id/generate-tickets
 *
 * Appends truck loads to a released order and issues a ticket for each.
 *
 * Everything runs inside one transaction against a locked order row, so two
 * people generating at the same moment cannot interleave: the second waits,
 * then recomputes its starting truck number against what the first committed.
 * That closes both the half-written-batch and duplicate-truck-number races.
 *
 * The whole trucks array is validated before anything is written, so a
 * malformed sixth truck rejects the request rather than half-creating five.
 */
const generateOrderTickets = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const trucks = Array.isArray(req.body.trucks) ? req.body.trucks : [];

  if (trucks.length === 0) {
    throw httpErr(400, "Provide at least one truck");
  }

  const result = await db.transaction(async (tx) => {
    const order = await orderRepo.lockById(orderId, tx);
    if (!order) throw httpErr(404, "Order not found");
    if (!TICKETABLE.has(order.status)) {
      throw httpErr(409, `Order is ${order.status}; tickets are generated after release`);
    }

    // ── Validate the whole batch first — all or nothing ────────────────────
    trucks.forEach((t, i) => {
      const where = `Truck ${i + 1}`;
      const qty = Number(t.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw httpErr(400, `${where}: quantity must be greater than zero`);
      }
      if (qty > MAX_TRUCK_LITRES) {
        throw httpErr(
          400,
          `${where}: ${qty.toLocaleString()} exceeds the ${MAX_TRUCK_LITRES.toLocaleString()} per-truck limit`,
        );
      }
      if (!String(t.driverName || "").trim()) throw httpErr(400, `${where}: driver name is required`);
      if (!String(t.driverPhone || "").trim()) throw httpErr(400, `${where}: driver phone is required`);
      if (!String(t.truckNumber || "").trim()) throw httpErr(400, `${where}: plate number is required`);
    });

    // ── Quantity ceiling ──────────────────────────────────────────────────
    // This backend settles orders in full from the wallet — paymentStatus is
    // binary, so there is no partial-payment figure to divide by unit price.
    // The ceiling is therefore the order quantity itself. If split payments
    // are introduced later, the releasable figure replaces the capacity below.
    const existing = await orderTruckRepo.findByOrder(orderId, tx);
    const alreadyTicketed = existing.reduce((s, l) => s + Number(l.quantity || 0), 0);
    const incoming = trucks.reduce((s, t) => s + Number(t.quantity), 0);
    const capacity = Number(order.quantity);

    if (alreadyTicketed + incoming > capacity) {
      throw httpErr(400, `Exceeds order quantity: ${(alreadyTicketed + incoming).toLocaleString()} requested against ${capacity.toLocaleString()} ordered (${alreadyTicketed.toLocaleString()} already ticketed)`);
    }

    // ── Append, continuing the numbering ──────────────────────────────────
    // Read under the row lock, so a concurrent call cannot pick the same start.
    const startIndex = existing.reduce((max, l) => Math.max(max, Number(l.truckIndex || 0)), 0);

    const created = [];
    for (let i = 0; i < trucks.length; i++) {
      const t = trucks[i];
      const load = await orderTruckRepo.create(
        {
          orderId,
          truckIndex: startIndex + i + 1,
          truckId: t.truckId ?? null,
          truckNumber: String(t.truckNumber).trim(),
          quantity: String(t.quantity),
          compartments: t.compartments ?? null,
          driverName: String(t.driverName).trim(),
          driverPhone: String(t.driverPhone).trim(),
          loaderName: t.loaderName ?? null,
          loaderPhone: t.loaderPhone ?? null,
          status: "pending",
        },
        tx,
      );

      const ticket = await generateTicketForTruck(order, load, tx);
      created.push({ load, ticket });

      await auditLogRepo.record(
        {
          entityType: "order_truck",
          entityId: load.id,
          action: "order_truck.ticket_generated",
          actor: { type: "staff", staffId: req.user.id },
          metadata: {
            orderId,
            truckIndex: load.truckIndex,
            truckNumber: load.truckNumber,
            quantity: String(t.quantity),
            via: "generate-tickets",
          },
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
        tx,
      );
    }

    // First generation moves the order onto the loading floor. The order's
    // plate is backfilled from the first truck when it has none.
    const patch = {};
    if (order.status === "Released") patch.status = "Loading";
    if (Object.keys(patch).length) await orderRepo.update(orderId, patch, tx);

    // ── Deduct PFI stock ───────────────────────────────────────────────────
    // Stock moves at ticket generation, not at payment or release: a ticket is
    // what lets product physically leave, so this is the moment it stops being
    // available to sell.
    //
    // One row per (order, RELEASE), enforced by a unique index. Re-running
    // generation therefore cannot deduct the same order twice — the second
    // call updates the existing row rather than inserting beside it.
    //
    // The quantity written is the cumulative ticketed total, not this batch's
    // increment. That keeps the deduction honest when trucks are added over
    // several sittings while still leaving exactly one row to reverse.
    const ticketedTotal = alreadyTicketed + incoming;
    if (order.pfiId) {
      await tx
        .insert(pfiMovements)
        .values({
          pfiId: Number(order.pfiId),
          orderId,
          action: "RELEASE",
          qtyLitres: ticketedTotal,
          notes: `Ticket generation — ${created.length} truck(s)`,
          recordedBy: req.user?.id ?? null,
        })
        .onConflictDoUpdate({
          target: [pfiMovements.orderId, pfiMovements.action],
          // Only the quantity moves; the original note records when the batch
          // first left.
          set: { qtyLitres: ticketedTotal },
        });
    }

    return {
      generated: created.length,
      startedAt: startIndex + 1,
      totalTicketed: alreadyTicketed + incoming,
      orderQuantity: capacity,
      remaining: capacity - (alreadyTicketed + incoming),
      trucks: created.map((c) => c.load),
    };
  });

  res.json({
    success: true,
    message: `${result.generated} ticket${result.generated === 1 ? "" : "s"} generated`,
    data: result,
  });
});

/**
 * GET /:id/trucks/:loadId/print
 *
 * Flattened print payload for one truck ticket — everything the printable
 * slip needs in one object, so the frontend renders rather than assembles.
 * Amount is this truck's share, not the order total.
 */
const getTruckTicketPrintData = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const loadId = Number(req.params.loadId);

  // findByIdFull joins customer, depot and product — the bare row has none.
  const order = await orderRepo.findByIdFull(orderId);
  if (!order) throw httpErr(404, "Order not found");

  const loads = await orderTruckRepo.findByOrder(orderId);
  const load = loads.find((l) => l.id === loadId);
  if (!load) throw httpErr(404, "Truck load not found on this order");

  const unitPrice = Number(order.price);
  const litres = Number(load.quantity);

    res.json({
    success: true,
    data: {
      reference: order.orderNumber,
      company: order.companyName || order.customerCompanyName || "",
      customerName: order.customerName || "",
      customerPhone: order.customerPhone || "",
      product: order.productName || "",
      productUnit: order.productUnit || "Litres",
      location: order.depotName || order.state || "",
      truckNumber: load.truckIndex,
      plateNumber: load.truckNumber,
      litres,
      unitPrice,
      // This truck's share of the order, not the order total.
      amount: litres * unitPrice,
      // Booked at generation, then as observed at the gate.
      driverName: load.driverName || "",
      driverPhone: load.driverPhone || "",
      entryDriverName: load.entryDriverName || "",
      entryDriverPhone: load.entryDriverPhone || "",
      gantry: load.gantry || "",
      loaderName: load.loaderName || "",
      loadingAt: load.loadedAt || load.securityEnteredAt || null,
      enteredAt: load.securityEnteredAt || null,
      exitedAt: load.securityExitedAt || null,
      status: load.status,
      totalTrucks: loads.length,
    },
  });
});

/** GET /:id/trucks — the loads on an order, for the ticketing desk. */
const getOrderTrucks = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const order = await orderRepo.findById(orderId);
  if (!order) throw httpErr(404, "Order not found");
  const trucks = await orderTruckRepo.findByOrder(orderId);
  res.json({ success: true, data: { trucks } });
});

/**
 * POST /:id/reconcile — re-run the post-payment side effects (loading ticket,
 * commission, WhatsApp confirmation) for a paid order whose effects failed the
 * first time. runPostPaymentEffects is idempotent — it no-ops anything that
 * already exists — so this only fills the gaps and never duplicates. Finance-
 * gated at the route.
 */
const reconcileOrderEffects = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const order = await orderRepo.findById(orderId);
  if (!order) throw httpErr(404, "Order not found");
  if (order.paymentStatus !== "Paid") {
    throw httpErr(409, "Only a paid order can have its post-payment effects reconciled");
  }

  const result = await orderService.runPostPaymentEffects(orderId);

  res.json({
    success: true,
    message: "Post-payment effects reconciled",
    data: { orderId, ...result },
  });
});

module.exports = {
  getOrders,
  getOrderById,
  createOrder,
  releaseOrder,
  cancelOrder,
  generateOrderTickets,
  getTruckTicketPrintData,
  getOrderTrucks,
  gateInTruck,
  markTruckLoaded,
  gateOutTruck,
  getPayableOrders,
  payOrder,
  reconcileOrderEffects,
};
