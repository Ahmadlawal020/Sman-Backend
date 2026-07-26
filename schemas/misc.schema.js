const z = require("zod");
const { id, money, nonEmptyString, optionalString, pagination } = require("./fields");

/**
 * Schemas for the remaining CRUD resources. Grouped in one file because each
 * is small and they share a shape; split them out if any grows real rules.
 *
 * Every list schema exists mainly to bound `limit`. Several controllers
 * defaulted to 500, and an unbounded limit is a cheap way to make the database
 * do a lot of work from an unauthenticated-adjacent surface.
 */

const idParam = z.object({ id });

// --- products -------------------------------------------------------------

const productBase = {
  name: optionalString(255),
  sku: optionalString(100),
  category: optionalString(100),
  gradeClass: optionalString(100),
  description: optionalString(1000),
  density: optionalString(50),
  flashPoint: optionalString(50),
  unNumber: optionalString(50),
  hazardClass: optionalString(50),
  stockLevel: money().optional(),
  unit: optionalString(50),
  supplier: optionalString(255),
};
const createProduct = z.object({ ...productBase, name: nonEmptyString(255) });
const updateProduct = z.object(productBase).partial();
const listProducts = pagination.extend({ search: z.string().trim().max(200).optional() });

// --- trucks ---------------------------------------------------------------

const listTrucks = pagination.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(["In Transit", "Idle", "Maintenance", "all"]).optional(),
});

// --- drivers --------------------------------------------------------------

const driverBase = {
  name: optionalString(255),
  email: z.string().trim().max(255).email().optional().or(z.literal("")),
  phone: optionalString(30),
  licenseNumber: optionalString(100),
  licenseClass: optionalString(50),
  rating: optionalString(20),
  status: z.enum(["Active", "On Trip", "Off Duty"]).optional(),
  safetyScore: optionalString(20),
};
const createDriver = z.object({ ...driverBase, name: nonEmptyString(255) });
const updateDriver = z.object(driverBase).partial();
const listDrivers = pagination.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(["Active", "On Trip", "Off Duty", "all"]).optional(),
});

// --- PFIs -----------------------------------------------------------------

const listPfis = pagination.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(["active", "finished", "all"]).optional(),
  location: z.string().trim().max(255).optional(),
});

// --- tickets --------------------------------------------------------------

const listTickets = pagination.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(["Active", "Redeemed", "all"]).optional(),
});
/** Accepts a numeric id or a ticket code, so it stays a bounded string. */
const ticketIdOrCode = z.object({ idOrCode: nonEmptyString(100) });

// --- filling stations -----------------------------------------------------

const stationBase = {
  name: optionalString(255),
  phone: optionalString(30),
  manager: optionalString(255),
  street: optionalString(500),
  city: optionalString(255),
  state: optionalString(255),
  tankCapacity: money().optional(),
  pumpCount: z.number().int().nonnegative().optional(),
  creditLimit: money().optional(),
  notes: optionalString(1000),
};
const createStation = z.object({ ...stationBase, name: nonEmptyString(255) });
const updateStation = z.object(stationBase).partial();
const listStations = pagination.extend({ search: z.string().trim().max(200).optional() });

// --- delivery inventory ---------------------------------------------------

/**
 * AUDIT H4 — `update(record.id, req.body)` took the raw body. The whitelist is
 * the fix; `allocationCode` and the account arrays stay settable because the
 * desk genuinely edits them, but nothing outside this list survives.
 */
const inventoryBase = {
  truckId: id.optional(),
  truckNumber: optionalString(100),
  pfiId: id.optional(),
  pfiNumber: optionalString(100),
  pfiProduct: optionalString(100),
  depot: optionalString(255),
  customerId: id.optional(),
  customerName: optionalString(255),
  quantityAllocated: money().optional(),
  rate: money().optional(),
  dateAllocated: optionalString(40),
  dateOffloaded: optionalString(40),
  loadingStatus: z.enum(["loaded", "offloaded", "empty", ""]).optional(),
  location: optionalString(255),
  pfiLocation: optionalString(255),
  allocationCode: optionalString(64),
  notes: optionalString(1000),
};
const createInventory = z.object(inventoryBase).partial();
const updateInventory = z.object(inventoryBase).partial();
const listInventory = pagination.extend({
  search: z.string().trim().max(200).optional(),
  loading_status: z.enum(["loaded", "offloaded", "empty", "all"]).optional(),
  truck_number: z.string().trim().max(100).optional(),
});

// --- staff ----------------------------------------------------------------

/**
 * NOTE — this schema does NOT close AUDIT H5.
 *
 * `roles` and `suspended` are legitimately editable here, so validating their
 * shape changes nothing about who may edit them. H5 is that
 * `PATCH /api/admin/:id` carries no `requireRole("super_admin")`, letting any
 * `admin` promote themselves. That is authorization, and it stays open.
 */
const staffBase = {
  first_name: optionalString(100),
  surname: optionalString(100),
  other_names: optionalString(200),
  email: z.string().trim().max(255).email().optional().or(z.literal("")),
  phone_number: optionalString(30),
  roles: z.array(z.string().trim().min(1).max(50)).max(19).optional(),
  suspended: z.boolean().optional(),
};
const createStaff = z.object({
  ...staffBase,
  first_name: nonEmptyString(100),
  surname: nonEmptyString(100),
  email: z.string().trim().min(1).max(255).email(),
});
const updateStaff = z.object(staffBase).partial();
const listStaff = pagination.extend({ search: z.string().trim().max(200).optional() });

module.exports = {
  idParam,
  createProduct, updateProduct, listProducts,
  listTrucks,
  createDriver, updateDriver, listDrivers,
  listPfis,
  listTickets, ticketIdOrCode,
  createStation, updateStation, listStations,
  createInventory, updateInventory, listInventory,
  createStaff, updateStaff, listStaff,
};
