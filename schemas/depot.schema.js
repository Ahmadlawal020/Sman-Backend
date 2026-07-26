const { z } = require("zod");
const { id, money, nonEmptyString, optionalString, pagination } = require("./fields");

/**
 * Setting a fuel price. `money({ min: 0.01 })` rather than min 0: a zero price
 * is almost certainly a mistake, and it would make every order at that depot
 * free — the controller's existing `<= 0` check on read would then reject the
 * order with a confusing "no price configured".
 */
const updateProductPrice = z.object({
  productId: id,
  price: money({ min: 0.01 }),
});

const createDepot = z.object({
  name: nonEmptyString(255),
  code: optionalString(50),
  state: optionalString(100),
  address: optionalString(1000),
  status: z.enum(["Active", "Maintenance", "High Capacity"]).optional(),
});

const updateDepot = createDepot.partial();

const listDepots = pagination.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(["Active", "Maintenance", "High Capacity", "all"]).optional(),
});

const idParam = z.object({ id });

module.exports = {
  updateProductPrice,
  createDepot,
  updateDepot,
  listDepots,
  idParam,
};
