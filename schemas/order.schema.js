const z = require("zod");
const { id, quantity, nonEmptyString, pagination } = require("./fields");

/**
 * Note what is absent: `price` and `totalAmount`. They are resolved server-side
 * from the depot's configured price, and stripping them here means a
 * client-supplied price cannot reach the controller at all — it is no longer
 * merely ignored, it is gone.
 */
const createOrder = z.object({
  customer: id,
  depot: id,
  product: id,
  state: nonEmptyString(100),
  quantity,
  deliveryType: z.enum(["delivery", "pickup"]),
});

const listOrders = pagination.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(["Pending", "Completed", "Cancelled"]).optional(),
  customer: id.optional(),
  dateFrom: z.string().trim().max(40).optional(),
  dateTo: z.string().trim().max(40).optional(),
});

const idParam = z.object({ id });

module.exports = { createOrder, listOrders, idParam };
