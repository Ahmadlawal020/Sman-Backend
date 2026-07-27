const z = require("zod");
const {
  id, money, quantity, requiredString, optionalString, optionalEmail,
  enumOf, searchTerm, pagination,
} = require("./fields");

/**
 * AUDIT H4 — `update(id, req.body)` took the raw body, which made these
 * settable from a request. They are the reason it mattered:
 *
 *   virtualAccountNumber  the Paystack webhook matches an incoming payment to
 *                         a customer BY ACCOUNT NUMBER. Overwriting it
 *                         redirects someone else's money.
 *   virtualAccountBank
 *   virtualAccountName
 *   paystackCustomerId
 *
 * All four are absent here; they are written only by the DVA service.
 */
const base = {
  customerType: enumOf("Customer type", ["customer", "filling_station"]).optional(),
  customerCode: optionalString("Customer code", 64),
  name: optionalString("Name", 255),
  phoneNumber: optionalString("Phone number", 30),
  altPhoneNumber: optionalString("Alt phone number", 30),
  email: optionalEmail(),
  homeAddress: optionalString("Home address", 1000),
  officeAddress: optionalString("Office address", 1000),
  contactPerson: optionalString("Contact person", 255),
  contactPersonPhone: optionalString("Contact person phone", 30),
  stationAddress: optionalString("Station address", 1000),
  tankCapacity: money("Tank capacity").optional(),
  pumpCount: z.number().int("Pump count must be a whole number").nonnegative("Pump count cannot be negative").optional(),
  creditLimit: money("Credit limit").optional(),
  status: enumOf("Status", ["active", "dormant", "suspended"]).optional(),
  notes: optionalString("Notes", 1000),
};

const createDeliveryCustomer = z.object({ ...base, name: requiredString("Name", 255) });
const updateDeliveryCustomer = z.object(base).partial();

const listDeliveryCustomers = pagination.extend({
  type: enumOf("Type", ["customer", "filling_station"]).optional(),
  search: searchTerm,
  status: enumOf("Status", ["active", "dormant", "suspended", "all"]).optional(),
});

const idParam = z.object({ id: id("Customer id") });

module.exports = {
  createDeliveryCustomer,
  updateDeliveryCustomer,
  listDeliveryCustomers,
  idParam,
};
