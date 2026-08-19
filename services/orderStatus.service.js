const { eq } = require("drizzle-orm");
const { db } = require("../config/db");
const { consumerOrder: orders, consumerCustomer: customers } = require("../db/schema");
const { auditLogRepo, customerRepo } = require("../repositories");
const { notify } = require("../notifications");
const { generateOrderReference } = require("../utils/helpers");
const { STATUS_TO_LIVE, fromLiveStatus, completedReleaseStatus } = require("../utils/orderStatusMapping");

/**
 * The order state machine — the ONE place order.status changes.
 *
 * Pipeline: Pending → Paid → Released → Loading → Completed, with Cancelled as
 * an exit up to and including Released, and Expired as an automatic exit from
 * Pending only (the expiry sweep, for orders never funded in time). Every
 * transition writes the new status,
 * its stage columns and one audit_logs row inside a single transaction, and
 * takes a row lock so two concurrent transitions on the same order cannot both
 * win — the loser re-reads the new status and finds its move no longer legal.
 *
 * STATUS MODEL, LIVE SCHEMA: Django's consumer_order.status is its own
 * six-value enum (pending/paid/released/loaded/sold/canceled — see
 * soroman_backend-2/consumer/models.py's OrderStatus), not Sman's seven
 * (Pending/Paid/Released/Loading/Completed/Cancelled/Expired). Verified
 * against the actual Django trigger code, not inferred from the enum labels:
 *
 *  - administration/views.py:2255 flips released -> loaded the moment the
 *    FIRST ticket is generated ("Transition order to loaded on first ticket
 *    generation") — that is Sman's Released -> Loading instant, not
 *    "finished loading". Django's `loaded` covers both Sman's Loading AND
 *    Completed; there is no further main-status value after it for a
 *    regular order.
 *  - 'sold' (views.py:2596) is exclusively for order_type='in_house' — a
 *    different, special-case admin sale flow this codebase's placeOrder
 *    never creates ("Only in-house orders can be sold via this endpoint").
 *    Not used for the regular customer order pipeline at all.
 *  - Django's SEPARATE release_status field (OrderReleseStatus:
 *    pending/delivered/picked) is what actually distinguishes "still
 *    loading" from "done" — Sman's Completed maps to release_status
 *    becoming delivered (deliveryType delivery) or picked (pickup), with
 *    the main status staying at `loaded`. So Loading and Completed are
 *    the SAME live `status` value, disambiguated by `release_status` —
 *    see toLiveStatus/fromLive below.
 *  - No `canceled`-adjacent value for Expired either. Both write live
 *    `canceled`; which one it was survives only in sman.audit_logs'
 *    metadata.reason (already how the expiry sweep records "unpaid past
 *    expiry window") — a human reading Django's own admin sees a plain
 *    cancellation, which is the truthful, available-on-the-live-schema
 *    story.
 *
 * Every OTHER file in this app (order.service.js, the portal, WhatsApp,
 * every frontend) keeps seeing exactly the same seven Sman-vocabulary
 * strings as before — the translation happens only at this boundary and in
 * order.repository.js's read-side decoration, not by touching every caller.
 */

// from → [legal to], in Sman vocabulary — unchanged from before the cutover.
const TRANSITIONS = Object.freeze({
  Pending: ["Paid", "Cancelled", "Expired"],
  Paid: ["Released", "Cancelled"],
  Released: ["Loading", "Cancelled"],
  Loading: ["Completed"],
  Completed: [],
  Cancelled: [],
  Expired: [],
});

const isLegal = (from, to) => (TRANSITIONS[from] || []).includes(to);

/**
 * Stamp the customer-facing reference and the Sman-vocabulary status onto a
 * raw live order row. Mirrors `formatOrderRow` in
 * repositories/order.repository.js — every read path in this file goes
 * through here so a row that reached the caller via `.returning()` rather
 * than a repository read still carries the ORD-… value corrected and the
 * live status translated, exactly like a normal repository read would.
 */
const decorateWithin = async (row, tx) => {
  if (!row) return row;

  let company = row.companyName || "";
  if (!company && row.userId) {
    const [c] = await tx
      .select({ companyName: customers.companyName })
      .from(customers)
      .where(eq(customers.id, row.userId))
      .limit(1);
    company = c?.companyName || "";
  }

  const ref = generateOrderReference(company, row.id);
  return {
    ...row,
    orderNumber: ref,
    reference: ref,
    customerId: row.userId,
    status: fromLiveStatus(row),
  };
};

/**
 * Which notification each arrival announces.
 *
 * Hooked here, in the state machine, rather than at the eight call sites that
 * drive it: this is already documented as the ONE place order.status changes,
 * so hanging the notification off it means a release triggered from the gate
 * flow, from the settlement sweep or from a future admin screen all notify
 * identically — and nobody has to remember to add the call.
 *
 * `Expired` is absent deliberately. order.service.js already owns that one,
 * because it sends the lapse SMS alongside it; announcing it here too would
 * split ownership of a single message across two files.
 */
const ARRIVAL_NOTIFICATIONS = Object.freeze({
  Paid: "order.paid",
  Released: "order.released",
  Loading: "order.loading",
  Completed: "order.completed",
  Cancelled: "order.cancelled",
});

/**
 * Announce a status arrival. Runs AFTER the transaction has committed, and
 * swallows everything: the transition is the business fact, and a notification
 * failure must never roll it back or surface as a 500 to the caller.
 */
async function announce(order, toStatus, opts) {
  const type = ARRIVAL_NOTIFICATIONS[toStatus];
  if (!type || !order?.customerId) return;

  try {
    const customer = await customerRepo.findById(order.customerId);
    if (!customer) return;

    const reference = generateOrderReference(
      order.companyName || customer.companyName,
      order.id
    );

    notify(type, {
      to: { customer },
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        reference,
        customerName: `${customer.firstName || ""} ${customer.lastName || ""}`.trim(),
        quantity: order.quantity,
        totalAmount: order.totalPrice,
        amountPaid: opts.metadata?.amountPaid ?? order.totalPrice,
        truckNumber: opts.metadata?.truckNumber,
        reason: opts.metadata?.reason,
      },
    });

    // Payment is the one arrival the desk also needs to see: it is the signal
    // that an order is ready to release.
    if (toStatus === "Paid") {
      notify("staff.payment_received", {
        to: { roles: ["admin", "super_admin", "finance_manager", "sales_manager"] },
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          reference,
          customerName: `${customer.firstName || ""} ${customer.lastName || ""}`.trim(),
          amountPaid: opts.metadata?.amountPaid ?? order.totalPrice,
        },
      });
    }
  } catch (err) {
    console.error(`[notify] order.${toStatus.toLowerCase()} announcement failed:`, err.message);
  }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/**
 * Apply a status transition atomically. `toStatus` and the order's current
 * status are both Sman vocabulary throughout — translated to/from the live
 * columns only where they touch the database.
 *
 * @param {number} orderId
 * @param {string} toStatus
 * @param {object} opts
 * @param {object} opts.actor        { type, staffId?, customerId? } — for the audit row
 * @param {object} [opts.set]        stage columns to write (released_at/by, …)
 * @param {string} [opts.action]     audit action label; defaults to order.<status>
 * @param {object} [opts.metadata]   audit metadata (reason, amounts, truck ids)
 * @param {string} [opts.ipAddress]
 * @param {string} [opts.userAgent]
 * @param {object} [opts.tx]         run inside an existing transaction (truck flow)
 * @returns {object} the updated order row
 */
async function transition(orderId, toStatus, opts = {}) {
  const run = async (tx) => {
    // Lock the row: the guard that makes concurrent transitions single-winner.
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update")
      .limit(1);

    if (!order) throw httpError(404, "Order not found");

    const fromStatus = fromLiveStatus(order);
    if (fromStatus === toStatus) {
      throw httpError(409, `Order is already ${toStatus}`);
    }
    if (!isLegal(fromStatus, toStatus)) {
      throw httpError(409, `An order cannot move from ${fromStatus} to ${toStatus}`);
    }

    const liveSet = { status: STATUS_TO_LIVE[toStatus], ...(opts.set || {}) };
    if (toStatus === "Completed") {
      liveSet.releaseStatus = completedReleaseStatus(order.releaseType);
    }

    const [updated] = await tx
      .update(orders)
      .set(liveSet)
      .where(eq(orders.id, orderId))
      .returning();

    await auditLogRepo.record(
      {
        entityType: "order",
        entityId: orderId,
        action: opts.action || `order.${toStatus.toLowerCase()}`,
        prevState: fromStatus,
        newState: toStatus,
        actor: opts.actor,
        metadata: opts.metadata ?? null,
        ipAddress: opts.ipAddress ?? null,
        userAgent: opts.userAgent ?? null,
      },
      tx
    );

    // Inside run(), so `tx` is live whether the caller supplied a transaction
    // or we opened one. Decorating after db.transaction() resolves would be
    // too late — the transaction is closed and the lookup could not join it.
    return decorateWithin(updated, tx);
  };

  // Join a caller's transaction (the truck flow does several things at once),
  // or open a fresh one.
  const updated = opts.tx ? await run(opts.tx) : await db.transaction(run);

  // The row is already decorated by run(). Doing it there rather than at each
  // call site is the point: transition() is the single funnel every status
  // change flows through, so every present and future caller gets the same
  // reference the app, portal, dashboard and WhatsApp show — without having to
  // remember. Before this, an expiry SMS quoted an ORD-… nobody could look up.

  // Fire-and-forget, and deliberately NOT awaited. When the caller supplied a
  // transaction it may still be open, so awaiting a notification here would
  // hold a database transaction open across an HTTP call to Termii — the
  // classic way a queue of slow sends becomes a pile of lock waits.
  announce(updated, toStatus, opts);

  return updated;
}

/**
 * Release an order the instant its payment lands — Paid → Released, in the
 * caller's payment transaction.
 *
 * Payment is the only condition for release in this business. The desk was
 * clicking "release" on every paid order as a formality, and an order left
 * sitting at Paid is invisible to ticketing (TICKETABLE is Released/Loading),
 * so the formality was a stall. Running it inside the payment transaction means
 * an order can never commit as Paid without also being Released.
 *
 * Trucks are NOT allocated here — they are captured at ticketing for a delivery
 * order and at the gate for a pickup. The manual release endpoint still stands
 * for a desk that would rather allocate the fleet up front.
 *
 * Deliberately NOT wrapped in a try/catch. Both moves belong to one atomic
 * unit: the caller holds the order's row lock, so nothing can race the release,
 * and the only way it can fail is a database error — which should take the
 * payment down with it rather than commit a half-applied payment.
 */
async function releaseOnPayment(orderId, opts = {}) {
  return transition(orderId, "Released", {
    ...opts,
    actor: opts.actor || { type: "system" },
    set: { releasedAt: new Date().toISOString(), ...(opts.set || {}) },
    metadata: { trigger: "payment", ...(opts.metadata || {}) },
  });
}

module.exports = { TRANSITIONS, isLegal, transition, releaseOnPayment, httpError, fromLiveStatus, STATUS_TO_LIVE };
