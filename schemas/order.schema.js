const z = require("zod");
const {
  id,
  quantity,
  requiredString,
  optionalString,
  numberLike,
  enumOf,
  searchTerm,
  pagination,
} = require("./fields");

/**
 * Note what is absent: `price` and `totalAmount`. They are resolved server-side
 * from the depot's configured price, and stripping them here means a
 * client-supplied price cannot reach the controller at all — it is no longer
 * merely ignored, it is gone.
 */
const createOrder = z.object({
  customer: id("Customer"),
  depot: id("Depot"),
  product: id("Product"),
  state: requiredString("State", 100),
  quantity: quantity("Quantity"),
  deliveryType: enumOf("Delivery type", ["delivery", "pickup"]),
});

const listOrders = pagination.extend({
  search: searchTerm,
  // The full lifecycle pipeline — see services/orderStatus.service.js.
  status: enumOf("Status", [
    "Pending",
    "Paid",
    "Released",
    "Loading",
    "Completed",
    "Cancelled",
  ]).optional(),
  customer: id("Customer").optional(),
  dateFrom: z.string().trim().max(40, "Start date is too long").optional(),
  dateTo: z.string().trim().max(40, "End date is too long").optional(),
});

const idParam = z.object({ id: id("Order id") });

// Cancel captures an optional human reason; it lands in cancellationReason and
// the audit row's metadata.
const cancelOrder = z.object({
  reason: z.string().trim().max(500, "Reason is too long").optional(),
});

// One truck load in a release allocation. A plate is required — either a fleet
// vehicle id (its plate is copied from the registry) or a free-form plate for
// an external haulier. The per-load quantity ≤ one tanker; the cross-load
// invariant (sum === order quantity) is enforced in the controller against the
// order row, not here.
const truckAllocation = z
  .object({
    truckId: id("Fleet truck").optional(),
    truckNumber: optionalString("Truck number", 100),
    quantity: quantity("Truck quantity"),
    driverName: optionalString("Driver name", 255),
    driverPhone: optionalString("Driver phone", 50),
    loaderName: optionalString("Loader name", 255),
    loaderPhone: optionalString("Loader phone", 50),
    compartments: z
      .array(
        z.object({
          qty: numberLike("Compartment quantity"),
          ullage: numberLike("Compartment ullage").optional(),
        })
      )
      .max(10, "A tanker has at most 10 compartments")
      .optional(),
  })
  .refine((t) => t.truckId != null || (t.truckNumber && t.truckNumber.length), {
    message: "Each truck needs a plate — a fleet truckId or a truckNumber",
    path: ["truckNumber"],
  });

// Release body. Delivery orders carry the fleet-truck allocation here (captured
// at release); pickup orders carry none — their trucks are captured by security
// at gate-in. The delivery/pickup branch and the sum check live in the
// controller, which has the order row.
const releaseOrder = z.object({
  trucks: z.array(truckAllocation).max(20, "Too many trucks on one order").optional(),
});

// Gate-in body. A delivery order references the load allocated at release
// (loadId); a pickup order has no load yet, so security captures the customer's
// own truck here (truckNumber + quantity, plus optional driver/compartments).
// Which fields are required is decided in the controller from the order type.
const gateIn = z.object({
  loadId: id("Load").optional(),
  truckNumber: optionalString("Truck number", 100),
  quantity: quantity("Truck quantity").optional(),
  driverName: optionalString("Driver name", 255),
  driverPhone: optionalString("Driver phone", 50),
  compartments: z
    .array(
      z.object({
        qty: numberLike("Compartment quantity"),
        ullage: numberLike("Compartment ullage").optional(),
      })
    )
    .max(10, "A tanker has at most 10 compartments")
    .optional(),
});

// A load-scoped route: /orders/:id/trucks/:loadId/...
const loadParam = z.object({ id: id("Order id"), loadId: id("Load id") });

module.exports = {
  createOrder,
  listOrders,
  idParam,
  cancelOrder,
  releaseOrder,
  gateIn,
  loadParam,
};
