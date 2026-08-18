const { eq, asc } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  consumerOrder: orders,
  consumerDepots: depots,
  depotExtras,
  consumerProduct: products,
  consumerTruckallocation: orderTrucks,
  consumerCustomer: customers,
  consumerOrderproduct,
} = require("../db/schema");
const { generateOrderReference, parseOrderReference } = require("../utils/helpers");

/**
 * Public order tracking — what anyone holding the reference may see.
 *
 * The order number is the shared secret, so this is unauthenticated; but it is
 * deliberately sanitised to movement only. It NEVER carries price, total, the
 * buyer's name/company, or their account — those stay behind sign-in. Volumes,
 * the depot, the stage timeline, and (once assigned) the truck plate are the
 * whole surface, because that is all a driver at a gate needs.
 *
 * The six public stages map onto the order's lifecycle timestamps:
 *   received          ← created_at (always)
 *   payment_confirmed ← payment_confirmed_at
 *   processing        ← payment_confirmed_at (paid, depot preparing the load)
 *   released          ← released_at
 *   loading           ← loading_started_at
 *   completed         ← completed_at
 * A cancelled order is not publicly trackable (returns null → 404); its state
 * is the customer's business, surfaced to them behind sign-in.
 */

// Per-truck movement, in words. Driver details are deliberately absent — a
// plate is on a public road, a driver's name and phone are not.
const TRUCK_STATUS_LABEL = {
  pending: "Assigned",
  // A ticketed truck is cleared to load but has not reached the gate yet, so
  // this names the paperwork rather than claiming work already done.
  loaded: "Ticket issued",
  gated_in: "At the depot",
  gated_out: "Departed",
};

// Counted off the gate, not off the ticket: a truck that has driven back out is
// the only one certainly carrying product.
const loadedCount = (trucks) => trucks.filter((t) => t.status === "gated_out").length;

const NOTE = {
  received: () => "Order received — awaiting payment.",
  payment_confirmed: () => "Payment confirmed.",
  processing: (o) => `Payment confirmed — ${o.depotName} is preparing your load.`,
  released: (o) =>
    o.trucks.length
      ? `Released — ${o.trucks.length} truck${o.trucks.length > 1 ? "s" : ""} assigned, waiting to load.`
      : "Released — waiting for a truck to load.",
  loading: (o) => {
    if (!o.trucks.length) return `Loading at ${o.depotName}.`;
    const done = loadedCount(o.trucks);
    return done < o.trucks.length
      ? `Loading at ${o.depotName} — ${done} of ${o.trucks.length} trucks loaded.`
      : `All ${o.trucks.length} trucks loaded at ${o.depotName}.`;
  },
  completed: () => "Loaded and signed out at the depot gate.",
  cancelled: () => "This order has been cancelled.",
};

const currentStage = (o) => {
  if (o.completedAt) return "completed";
  if (o.loadingStartedAt) return "loading";
  if (o.releasedAt) return "released";
  if (o.paymentConfirmedAt) return "processing";
  return "received";
};

/**
 * Build the `reached` map from an order's lifecycle stamps. Shared by the
 * public tracking feed and the owner's own detail so both surfaces stamp the
 * same stages from the same columns. `cancelled` is only set when the order
 * was cancelled — the public feed never returns cancelled orders, but the
 * owner's detail does.
 */
const buildReached = (row) => {
  const reached = { received: row.createdAt };
  if (row.paymentConfirmedAt) {
    reached.payment_confirmed = row.paymentConfirmedAt;
    reached.processing = row.paymentConfirmedAt;
  }
  if (row.releasedAt) reached.released = row.releasedAt;
  if (row.loadingStartedAt) reached.loading = row.loadingStartedAt;
  if (row.completedAt) reached.completed = row.completedAt;
  if (row.cancelledAt) reached.cancelled = row.cancelledAt;
  return reached;
};

/** One-line situation report for the current stage. Needs `depotName` + `trucks`. */
const stageNote = (stage, row) => (NOTE[stage] ? NOTE[stage](row) : null);

const trackByRef = async (ref) => {
  const normalized = String(ref || "").trim().toUpperCase();
  if (!normalized) return null;

  // No stored order_number live — every reference resolves through the id
  // (see repositories/order.repository.js). Accepts "SO600", the legacy
  // "SO/600", and a bare id, so a reference printed on any invoice or SMS
  // ever sent still tracks; anything that isn't reference-shaped 404s.
  const possibleId = parseOrderReference(normalized);
  if (!possibleId) return null;

  // consumer_order (live, canonical) has no depotId at all — only pfiId, and
  // a PFI's own locationId points at a STATE, not a depot (see
  // order.repository.js's header comment; that repo flags the same gap
  // rather than inventing a resolution). depotName is dropped here for the
  // same reason, not guessed. Column renames: deliveryType -> releaseType,
  // no completedAt/loadingStartedAt (nearest proxies: security_exited_at /
  // loading_datetime), status uses "canceled" (Django's spelling).
  const [row] = await db
    .select({
      id: orders.id,
      customerCompanyName: customers.companyName,
      status: orders.status,
      quantity: consumerOrderproduct.quantity,
      deliveryType: orders.releaseType,
      deliveryAddress: orders.deliveryAddress,
      state: orders.destinationState,
      createdAt: orders.createdAt,
      paymentConfirmedAt: orders.paymentConfirmedAt,
      releasedAt: orders.releasedAt,
      loadingStartedAt: orders.loadingDatetime,
      completedAt: orders.securityExitedAt,
      productName: products.name,
      productUnit: products.unit,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.userId, customers.id))
    .leftJoin(consumerOrderproduct, eq(consumerOrderproduct.orderId, orders.id))
    .leftJoin(products, eq(consumerOrderproduct.productId, products.id))
    .where(eq(orders.id, possibleId))
    .limit(1);

  if (!row) return null;
  row.depotName = "";
  row.depotState = row.state;

  const displayRef = generateOrderReference(row.customerCompanyName, row.id);

  // Django's spelling: status = 'canceled', not a separate cancelledAt
  // column (see order.repository.js's header comment) — createdAt stands in
  // for the cancellation timestamp since there's nowhere live to read one.
  if (row.status === "canceled") {
    return {
      ref: displayRef,
      placedAt: row.createdAt,
      depotName: row.depotName,
      depotState: row.depotState,
      lines: [
        {
          category: row.productCategory || null,
          name: row.productName,
          quantity: row.quantity,
          unit: row.productUnit || "Liters",
        },
      ],
      stage: "cancelled",
      reached: { received: row.createdAt, cancelled: row.createdAt },
      note: "This order has been cancelled.",
      trucks: [],
    };
  }

  // Every allocated truck and where it is, once trucks have been assigned at
  // release. Plate + status only — never the driver's name or phone.
  // consumer_truckallocation's `truck_number` is a sequence int (the old
  // model's truckIndex); the plate lives in `plate_number`, and status is
  // `ticket_status`.
  const truckRows = await db
    .select({
      truckIndex: orderTrucks.truckNumber,
      truckNumber: orderTrucks.plateNumber,
      status: orderTrucks.ticketStatus,
    })
    .from(orderTrucks)
    .where(eq(orderTrucks.orderId, row.id))
    .orderBy(asc(orderTrucks.truckNumber));
  row.trucks = truckRows.map((t) => ({
    index: t.truckIndex,
    plate: t.truckNumber || null,
    status: t.status,
    statusLabel: TRUCK_STATUS_LABEL[t.status] || t.status,
  }));

  const stage = currentStage(row);
  // Public feed never returns Cancelled, so cancelled is never set here.
  const reached = buildReached(row);

  return {
    ref: displayRef,
    placedAt: row.createdAt,
    depotName: row.depotName,
    depotState: row.depotState,
    lines: [
      {
        category: row.productCategory || null,
        name: row.productName,
        quantity: row.quantity,
        unit: row.productUnit || "Liters",
      },
    ],
    delivery:
      row.deliveryType === "delivery"
        ? { type: "delivery", state: row.state, address: row.deliveryAddress || "" }
        : { type: "pickup" },
    stage,
    reached,
    note: stageNote(stage, row),
    // Present once trucks are assigned at release; empty before then.
    trucks: row.trucks,
  };
};

module.exports = { trackByRef, currentStage, buildReached, stageNote };
