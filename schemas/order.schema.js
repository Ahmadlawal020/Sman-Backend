const z = require("zod");
const { id, quantity, requiredString, enumOf, searchTerm, pagination } = require("./fields");

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

module.exports = { createOrder, listOrders, idParam, cancelOrder };
