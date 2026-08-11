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
  licenseExpiry: optionalString("License expiry", 40),
  rating: numberLike("Rating").optional(),
  status: enumOf("Status", ["Active", "On Trip", "Off Duty"]).optional(),
  safetyScore: numberLike("Safety score").optional(),
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
  status: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(enumOf("Status", ["active", "finished", "all"]))
    .optional()
    .or(z.literal("")),
  location: z.union([z.string(), z.number()]).transform((v) => String(v).trim()).optional().or(z.literal("")),
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

// --- bank accounts --------------------------------------------------------

const bankAccountBase = {
  bankName: requiredString("Bank name", 255),
  accountName: requiredString("Account name", 255),
  accountNumber: requiredString("Account number", 50),
  bankCode: optionalString("Bank code", 50),
  branchName: optionalString("Branch name", 255),
  accountType: optionalString("Account type", 50),
  currency: optionalString("Currency", 10),
  status: enumOf("Status", ["Active", "Inactive", "Suspended"]).optional(),
  isDefault: z.boolean({ error: "isDefault must be true or false" }).optional(),
  depotIds: z.array(z.union([id("Depot id"), z.string(), z.number()])).optional(),
  lpgStationIds: z.array(z.union([id("Station id"), z.string(), z.number()])).optional(),
  notes: optionalString("Notes", 1000),
};
const createBankAccount = z.object(bankAccountBase);
const updateBankAccount = z.object(bankAccountBase).partial();

// --- bank statements ------------------------------------------------------

const createBankStatement = z.object({
  bankAccountId: id("Bank account"),
  fileName: optionalString("File name", 255),
  statementDate: optionalString("Statement date", 40),
  lines: z.array(z.record(z.unknown())).optional(),
});
const bankStatementMapping = z.object({
  mapping: z.record(z.unknown()),
});
const matchBankLines = z.object({
  lineIds: z.array(id("Line id")).min(1, "At least one line is required"),
  depositId: id("Deposit"),
});

// --- expenses --------------------------------------------------------------

const expenseBase = {
  // A description is genuinely optional — the category, vendor and amount
  // already identify the line, and forcing prose here just gets "expense".
  description: optionalString("Description", 500),
  amount: money("Amount", { min: 0.01 }),
  // The category decides which cargo the line lands on, so it is the one
  // field the create path actually needs. Accepted as an id in either casing.
  category: id("Category").optional().nullable(),
  category_id: id("Category").optional().nullable(),
  categoryId: id("Category").optional().nullable(),
  vendor: optionalString("Vendor", 255),
  expense_date: optionalString("Expense date", 40),
  expenseDate: optionalString("Expense date", 40),
  bank_paid_from: optionalString("Bank paid from", 255),
  bankPaidFrom: optionalString("Bank paid from", 255),
  receipt_reference: optionalString("Receipt reference", 100),
  receiptReference: optionalString("Receipt reference", 100),
  // Where the money is going — shown to approvers before they authorise.
  payee_bank_name: optionalString("Payee bank", 200),
  payeeBankName: optionalString("Payee bank", 200),
  payee_account_number: optionalString("Payee account number", 50),
  payeeAccountNumber: optionalString("Payee account number", 50),
  payee_account_name: optionalString("Payee account name", 255),
  payeeAccountName: optionalString("Payee account name", 255),
  reference: optionalString("Reference", 100),
  notes: optionalString("Notes", 1000),
};
const createExpense = z.object(expenseBase);
const updateExpense = z.object(expenseBase).partial();
const categoryBase = {
  name: requiredString("Category name", 255),
  description: optionalString("Description", 500),
};
const createCategory = z.object(categoryBase);
const updateCategory = z.object(categoryBase).partial();

// --- dangote products -----------------------------------------------------

const dangoteProductBase = {
  name: requiredString("Product name", 255),
  code: optionalString("Code", 50),
  description: optionalString("Description", 1000),
  price: money("Price", { min: 0.01 }).optional(),
  unit: optionalString("Unit", 50),
  isActive: z.boolean().optional(),
};
const createDangoteProduct = z.object(dangoteProductBase);
const updateDangoteProduct = z.object(dangoteProductBase).partial();

// --- PFI create/update ----------------------------------------------------

const optPfiStr = (label, max = 255) =>
  z
    .union([z.string().trim().max(max, `${label} must be ${max} characters or fewer`), z.null()])
    .optional()
    .transform((v) => (v === null ? "" : v));

const optPfiId = (label = "id") =>
  z
    .union([id(label), z.literal(""), z.literal("none"), z.null()])
    .optional()
    .transform((v) => (v === "" || v === "none" || v === null ? null : v === undefined ? undefined : Number(v)));

const optPfiQty = (label = "Quantity") =>
  z
    .union([
      numberLike(label).pipe(z.number().int(`${label} must be a whole number`).nonnegative(`${label} cannot be negative`)),
      z.literal(""),
      z.null(),
    ])
    .optional()
    .transform((v) => (v === "" || v === null ? 0 : v === undefined ? undefined : Number(v)));

const optPfiBlQty = (label = "BL Quantity") =>
  z
    .union([
      numberLike(label).pipe(z.number().int(`${label} must be a whole number`).nonnegative(`${label} cannot be negative`)),
      z.literal(""),
      z.null(),
    ])
    .optional()
    .transform((v) => (v === "" || v === null ? null : v === undefined ? undefined : Number(v)));

const optPfiFloat = (label = "Volume") =>
  z
    .union([
      numberLike(label).pipe(z.number().nonnegative(`${label} cannot be negative`)),
      z.literal(""),
      z.null(),
    ])
    .optional()
    .transform((v) => (v === "" || v === null ? 0 : v === undefined ? undefined : Number(v)));

const optPfiMoney = (label = "Amount") =>
  z
    .union([
      money(label),
      numberLike(label).pipe(z.number().nonnegative(`${label} cannot be negative`)).transform((v) => v.toFixed(2)),
      z.literal(""),
      z.null(),
    ])
    .optional()
    .transform((v) => (v === "" || v === null ? "0.00" : v === undefined ? undefined : typeof v === "number" ? v.toFixed(2) : String(v)));

const optPfiDate = (label = "Date") =>
  z
    .union([
      z.string().trim().max(50),
      z.date(),
      z.literal(""),
      z.null(),
    ])
    .optional()
    .transform((v) => (v === "" || v === null ? null : v === undefined ? undefined : v));

const pfiBase = {
  pfiNumber: z.string().trim().max(100).optional(),
  pfi_number: z.string().trim().max(100).optional(),
  description: optPfiStr("Description", 1000),
  pfiDate: optPfiDate("PFI date"),
  pfi_date: optPfiDate("PFI date"),
  locationId: optPfiId("Location"),
  location_id: optPfiId("Location"),
  depotId: optPfiId("Depot"),
  depot_id: optPfiId("Depot"),
  location: optPfiStr("Location", 255),
  locationName: optPfiStr("Location name", 255),
  location_name: optPfiStr("Location name", 255),
  productId: optPfiId("Product"),
  product_id: optPfiId("Product"),
  productUnit: optPfiStr("Product unit", 50),
  product_unit: optPfiStr("Product unit", 50),
  startingQtyLitres: optPfiQty("Starting quantity"),
  starting_qty_litres: optPfiQty("Starting quantity"),
  blQtyLitres: optPfiBlQty("BL quantity"),
  bl_qty_litres: optPfiBlQty("BL quantity"),
  qtyVolumeMt: optPfiFloat("Quantity volume (MT)"),
  qty_volume_mt: optPfiFloat("Quantity volume (MT)"),
  unitPrice: optPfiMoney("Unit price"),
  unit_price: optPfiMoney("Unit price"),
  auditOfficerId: optPfiId("Audit officer"),
  audit_officer: optPfiId("Audit officer"),
  audit_officer_id: optPfiId("Audit officer"),
  productOfficerId: optPfiId("Product officer"),
  product_officer: optPfiId("Product officer"),
  product_officer_id: optPfiId("Product officer"),
  itComplianceOfficerId: optPfiId("IT compliance officer"),
  it_compliance_officer: optPfiId("IT compliance officer"),
  it_compliance_officer_id: optPfiId("IT compliance officer"),
  securityExitOfficerId: optPfiId("Security exit officer"),
  security_exit_officer: optPfiId("Security exit officer"),
  security_exit_officer_id: optPfiId("Security exit officer"),
  commissionOfficerId: optPfiId("Commission officer"),
  commission_officer: optPfiId("Commission officer"),
  commission_officer_id: optPfiId("Commission officer"),
  salesManagerId: optPfiId("Sales manager"),
  sales_manager: optPfiId("Sales manager"),
  sales_manager_id: optPfiId("Sales manager"),
  vesselBroker: optPfiStr("Vessel broker", 255),
  vessel_broker: optPfiStr("Vessel broker", 255),
  vesselName: optPfiStr("Vessel name", 255),
  vessel_name: optPfiStr("Vessel name", 255),
  surveyorName: optPfiStr("Surveyor name", 255),
  surveyor_name: optPfiStr("Surveyor name", 255),
  surveyorPhone: optPfiStr("Surveyor phone", 50),
  surveyor_phone: optPfiStr("Surveyor phone", 50),
  notes: optPfiStr("Notes", 1000),
  status: enumOf("Status", ["active", "finished"]).optional(),
  closureDate: optPfiDate("Closure date"),
  closure_date: optPfiDate("Closure date"),
  closureBank: optPfiStr("Closure bank", 255),
  closure_bank: optPfiStr("Closure bank", 255),
  closureHandler: optPfiStr("Closure handler", 255),
  closure_handler: optPfiStr("Closure handler", 255),
  closureRemarks: optPfiStr("Closure remarks", 1000),
  closure_remarks: optPfiStr("Closure remarks", 1000),
  totalInflow: optPfiMoney("Total inflow"),
  total_inflow: optPfiMoney("Total inflow"),
  purchaseCost: optPfiMoney("Purchase cost"),
  purchase_cost: optPfiMoney("Purchase cost"),
  aggregateExpenses: optPfiMoney("Aggregate expenses"),
  aggregate_expenses: optPfiMoney("Aggregate expenses"),
  soldQtyLitres: optPfiQty("Sold quantity"),
  sold_qty_litres: optPfiQty("Sold quantity"),
  totalAmount: optPfiMoney("Total amount"),
  total_amount: optPfiMoney("Total amount"),
};

const createPfi = z.object(pfiBase).refine(
  (d) => (d.pfiNumber && d.pfiNumber.length > 0) || (d.pfi_number && d.pfi_number.length > 0),
  { message: "PFI number is required", path: ["pfiNumber"] }
);
const updatePfi = z.object(pfiBase);

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
  createBankAccount, updateBankAccount,
  createBankStatement, bankStatementMapping, matchBankLines,
  createExpense, updateExpense, createCategory, updateCategory,
  createDangoteProduct, updateDangoteProduct,
  createPfi, updatePfi,
};
