const z = require("zod");
const { id, money, nonEmptyString, optionalString, pagination } = require("./fields");

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
  customerType: z.enum(["customer", "filling_station"]).optional(),
  customerCode: optionalString(64),
  name: optionalString(255),
  phoneNumber: optionalString(30),
  altPhoneNumber: optionalString(30),
  email: z.string().trim().max(255).email().optional().or(z.literal("")),
  homeAddress: optionalString(1000),
  officeAddress: optionalString(1000),
  contactPerson: optionalString(255),
  contactPersonPhone: optionalString(30),
  stationAddress: optionalString(1000),
  tankCapacity: money().optional(),
  pumpCount: z.number().int().nonnegative().optional(),
  creditLimit: money().optional(),
  status: z.enum(["active", "dormant", "suspended"]).optional(),
  notes: optionalString(1000),
};

const createDeliveryCustomer = z.object({ ...base, name: nonEmptyString(255) });
const updateDeliveryCustomer = z.object(base).partial();

const listDeliveryCustomers = pagination.extend({
  type: z.enum(["customer", "filling_station"]).optional(),
  search: z.string().trim().max(200).optional(),
  status: z.enum(["active", "dormant", "suspended", "all"]).optional(),
});

const idParam = z.object({ id });

module.exports = {
  createDeliveryCustomer,
  updateDeliveryCustomer,
  listDeliveryCustomers,
  idParam,
};
