const z = require("zod");
const {
  id, money, quantity, numberLike, requiredString, optionalString, optionalEmail,
  enumOf, searchTerm, pagination,
} = require("./fields");
const { ROLE_MAP } = require("../config/roleMapping");

const ROLE_COUNT = Object.keys(ROLE_MAP).length;

/**
 * Schemas for the remaining CRUD resources. Grouped in one file because each
 * is small and they share a shape; split them out if any grows real rules.
 *
 * Every list schema exists mainly to bound `limit`. Several controllers
 * defaulted to 500, and an unbounded limit is a cheap way to make the database
 * do a lot of work from an unauthenticated-adjacent surface.
 */

const idParam = z.object({ id: id("Id") });

// --- products -------------------------------------------------------------

const productBase = {
  name: optionalString("Name", 255),
  sku: optionalString("Sku", 100),
  category: optionalString("Category", 100),
  gradeClass: optionalString("Grade class", 100),
  description: optionalString("Description", 1000),
  density: optionalString("Density", 50),
  flashPoint: optionalString("Flash point", 50),
  unNumber: optionalString("Un number", 50),
  hazardClass: optionalString("Hazard class", 50),
  stockLevel: money("Stock level").optional(),
  unit: optionalString("Unit", 50),
  supplier: optionalString("Supplier", 255),
};
const createProduct = z.object({ ...productBase, name: requiredString("Name", 255), productType: z.string().trim().max(50).optional() });
const updateProduct = z.object(productBase).partial();
const listProducts = pagination.extend({
  search: searchTerm,
  productType: z.string().trim().max(50).optional(),
});

// --- trucks ---------------------------------------------------------------

const listTrucks = pagination.extend({
  search: searchTerm,
  status: enumOf("Status", ["In Transit", "Idle", "Maintenance", "all"]).optional(),
});

// --- drivers --------------------------------------------------------------

const driverBase = {
  name: optionalString("Name", 255),
  email: optionalEmail(),
  phone: optionalString("Phone", 30),
  licenseNumber: optionalString("License number", 100),
  licenseClass: optionalString("License class", 50),
  rating: optionalString("Rating", 20),
  status: enumOf("Status", ["Active", "On Trip", "Off Duty"]).optional(),
  safetyScore: optionalString("Safety score", 20),
};
const createDriver = z.object({ ...driverBase, name: requiredString("Name", 255) });
const updateDriver = z.object(driverBase).partial();
const listDrivers = pagination.extend({
  search: searchTerm,
  status: enumOf("Status", ["Active", "On Trip", "Off Duty", "all"]).optional(),
});

// --- PFIs -----------------------------------------------------------------

const listPfis = pagination.extend({
  search: searchTerm,
  status: enumOf("Status", ["active", "finished", "all"]).optional(),
  location: z.string().trim().max(255, "Value is too long").optional(),
});

// --- tickets --------------------------------------------------------------

const listTickets = pagination.extend({
  search: searchTerm,
  status: enumOf("Status", ["Active", "Redeemed", "all"]).optional(),
});
/** Accepts a numeric id or a ticket code, so it stays a bounded string. */
const ticketIdOrCode = z.object({ idOrCode: requiredString("Id or code", 100) });

// --- filling stations -----------------------------------------------------

const stationBase = {
  name: optionalString("Name", 255),
  phone: optionalString("Phone", 30),
  manager: optionalString("Manager", 255),
  street: optionalString("Street", 500),
  city: optionalString("City", 255),
  state: optionalString("State", 255),
  tankCapacity: money("Tank capacity").optional(),
  pumpCount: z.number().int("Pump count must be a whole number").nonnegative("Pump count cannot be negative").optional(),
  creditLimit: money("Credit limit").optional(),
  notes: optionalString("Notes", 1000),
};
const createStation = z.object({ ...stationBase, name: requiredString("Name", 255) });
const updateStation = z.object(stationBase).partial();
const listStations = pagination.extend({ search: searchTerm });

// --- delivery inventory ---------------------------------------------------

/**
 * AUDIT H4 — `update(record.id, req.body)` took the raw body. The whitelist is
 * the fix; `allocationCode` and the account arrays stay settable because the
 * desk genuinely edits them, but nothing outside this list survives.
 */
const inventoryBase = {
  truckId: id("Id").optional(),
  truckNumber: optionalString("Truck number", 100),
  pfiId: id("Id").optional(),
  pfiNumber: optionalString("Pfi number", 100),
  pfiProduct: optionalString("Pfi product", 100),
  depot: optionalString("Depot", 255),
  customerId: id("Id").optional(),
  customerName: optionalString("Customer name", 255),
  quantityAllocated: money("Quantity allocated").optional(),
  rate: money("Rate").optional(),
  dateAllocated: optionalString("Date allocated", 40),
  dateOffloaded: optionalString("Date offloaded", 40),
  loadingStatus: enumOf("Loading status", ["loaded", "offloaded", "empty", ""]).optional(),
  location: optionalString("Location", 255),
  pfiLocation: optionalString("Pfi location", 255),
  allocationCode: optionalString("Allocation code", 64),
  notes: optionalString("Notes", 1000),
};
const createInventory = z.object(inventoryBase).partial();
const updateInventory = z.object(inventoryBase).partial();
const listInventory = pagination.extend({
  search: searchTerm,
  loading_status: enumOf("Loading status", ["loaded", "offloaded", "empty", "all"]).optional(),
  truck_number: z.string().trim().max(100, "Value is too long").optional(),
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
  first_name: optionalString("First name", 100),
  surname: optionalString("Surname", 100),
  other_names: optionalString("Other names", 200),
  email: optionalEmail(),
  phone_number: optionalString("Phone number", 30),
  roles: z
    .array(
      numberLike("Role").pipe(
        z
          .number()
          .int("A role id must be a whole number")
          .refine((n) => n in ROLE_MAP, "Unknown role id")
      ),
      { error: (iss) => (iss.input === undefined ? "Roles are required" : "Roles must be a list") }
    )
    .min(1, "At least one role is required")
    .max(ROLE_COUNT, `A user cannot have more than ${ROLE_COUNT} roles`)
    .optional(),
  suspended: z.boolean({ error: "Suspended must be true or false" }).optional(),
};
const createStaff = z.object({
  ...staffBase,
  first_name: requiredString("First name", 100),
  surname: requiredString("Surname", 100),
  email: z.string().trim().min(1).max(255).email(),
});
const updateStaff = z.object(staffBase).partial();
const listStaff = pagination.extend({ search: searchTerm });

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
