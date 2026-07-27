const z = require("zod");
const { id, money, requiredString, optionalString, enumOf, searchTerm, pagination } = require("./fields");

const DEPOT_STATUS = ["Active", "Maintenance", "High Capacity"];

/**
 * Setting a fuel price. `min: 0.01` rather than 0: a zero price is almost
 * certainly a mistake, and it would make every order at that depot free — the
 * controller's existing `<= 0` check on read would then reject the order with
 * a confusing "no price configured".
 */
const updateProductPrice = z.object({
  productId: id("Product"),
  price: money("Price", { min: 0.01 }),
});

const createDepot = z.object({
  name: requiredString("Depot name", 255),
  code: optionalString("Depot code", 50),
  state: optionalString("State", 100),
  address: optionalString("Address", 1000),
  status: enumOf("Status", DEPOT_STATUS).optional(),
});

const updateDepot = createDepot.partial();

const listDepots = pagination.extend({
  search: searchTerm,
  status: enumOf("Status", [...DEPOT_STATUS, "all"]).optional(),
});

const idParam = z.object({ id: id("Depot id") });

module.exports = { updateProductPrice, createDepot, updateDepot, listDepots, idParam };
