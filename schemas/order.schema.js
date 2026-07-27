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
  status: enumOf("Status", ["Pending", "Completed", "Cancelled"]).optional(),
  customer: id("Customer").optional(),
  dateFrom: z.string().trim().max(40, "Start date is too long").optional(),
  dateTo: z.string().trim().max(40, "End date is too long").optional(),
});

const idParam = z.object({ id: id("Order id") });

module.exports = { createOrder, listOrders, idParam };
