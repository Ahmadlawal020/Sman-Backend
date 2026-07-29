const z = require("zod");
const { id, money, requiredString, optionalString, enumOf, searchTerm, pagination, numberLike } = require("./fields");

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
  address: optionalString("Address", 1000),
  city: optionalString("City", 100),
  state: optionalString("State", 100),
  country: optionalString("Country", 100),
  postcode: optionalString("Postcode", 20),
  establishedYear: optionalString("Established year", 10),
  status: enumOf("Status", DEPOT_STATUS).optional(),
  maxCapacity: numberLike("Max capacity").optional(),
  parkedTrucksCount: numberLike("Parked trucks count").optional(),
  productCapacities: z.array(
    z.object({
      product: z.any(),
      capacity: numberLike("Capacity"),
    })
  ).optional(),
  productPrices: z.array(
    z.object({
      product: z.any(),
      currentPrice: money("Current price", { min: 0.01 }),
    })
  ).optional(),
  staffIds: z.array(z.any()).optional(),
});

const updateDepot = createDepot.partial();

const listDepots = pagination.extend({
  search: searchTerm,
  status: enumOf("Status", [...DEPOT_STATUS, "all"]).optional(),
});

const idParam = z.object({ id: id("Depot id") });

module.exports = { updateProductPrice, createDepot, updateDepot, listDepots, idParam };
