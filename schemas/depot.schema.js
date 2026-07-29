const z = require("zod");
const { id, money, numberLike, requiredString, enumOf, searchTerm, pagination } = require("./fields");

const DEPOT_STATUS = ["Active", "Maintenance", "High Capacity"];

/**
 * A non-negative whole count for the integer columns (`capacity`,
 * `parked_trucks_count`, `max_capacity`). `numberLike` first so a form field
 * sending "30000" is accepted; the min floor matches each column's CHECK.
 */
const wholeCount = (label, { min = 0 } = {}) =>
  numberLike(label).pipe(
    z
      .number()
      .int(`${label} must be a whole number`)
      .min(min, `${label} must be at least ${min}`)
  );

/**
 * One row of the depot_product_capacities join. The controller reads
 * `pc.product` (the product id) and `pc.capacity`, so those are the names the
 * schema must whitelist — anything else is stripped before the controller
 * runs, which is exactly the bug this shape fixes.
 */
const productCapacity = z.object({
  product: id("Product"),
  capacity: wholeCount("Capacity", { min: 0 }),
});

const productPrice = z.object({
  product: id("Product"),
  currentPrice: money("Price", { min: 0.01 }),
});

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

/**
 * The full write shape of a depot. Every field the controller reads must be
 * declared here: the validate middleware strips unknown keys and replaces
 * req.body wholesale, so any omitted field never reaches the controller — that
 * silently dropped `productCapacities`, `staffIds`, `city`, `country`,
 * `postcode`, `maxCapacity` and `establishedYear` on write.
 */
const createDepot = z.object({
  name: requiredString("Depot name", 255),
  code: requiredString("Depot code", 50),
  address: requiredString("Address", 1000),
  city: requiredString("City", 100),
  state: requiredString("State", 100),
  country: requiredString("Country", 100),
  postcode: requiredString("Postcode", 20),
  parkedTrucksCount: wholeCount("Parked trucks count", { min: 0 }).optional(),
  maxCapacity: wholeCount("Max capacity", { min: 1 }),
  status: enumOf("Status", DEPOT_STATUS).optional(),
  establishedYear: requiredString("Established year", 10),
  productCapacities: z.array(productCapacity).optional(),
  productPrices: z.array(productPrice).optional(),
  staffIds: z.array(id("Staff id")).optional(),
});

const updateDepot = createDepot.partial();

const listDepots = pagination.extend({
  search: searchTerm,
  status: enumOf("Status", [...DEPOT_STATUS, "all"]).optional(),
});

const idParam = z.object({ id: id("Depot id") });

module.exports = { updateProductPrice, createDepot, updateDepot, listDepots, idParam };
