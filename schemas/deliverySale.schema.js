const z = require("zod");
const {
  id, money, quantity, requiredString, optionalString, optionalEmail,
  enumOf, searchTerm, pagination,
} = require("./fields");

/**
 * AUDIT H4 — this controller called `deliverySaleRepo.create(req.body)` and
 * `update(id, req.body)` with the raw body. Three columns made that dangerous,
 * and all three are deliberately absent from these schemas:
 *
 *   paystackReference  pre-claiming a reference poisons webhook idempotency,
 *                      so a real incoming payment is later dropped as a
 *                      duplicate and the money is never credited
 *   paystackDetails    attacker-authored payment metadata
 *   depositStatus      forge a fully-paid sale outright
 *
 * They are written by the payment pipeline, never by a request. Because zod
 * strips unknown keys, sending them now removes them rather than ignoring them.
 */
const base = {
  truckNumber: optionalString("Truck number", 100),
  dateLoaded: optionalString("Date loaded", 40),
  depotLoaded: optionalString("Depot loaded", 255),
  customerId: id("Customer").optional(),
  customerName: optionalString("Customer name", 255),
  location: optionalString("Location", 255),
  quantity: quantity("Quantity").optional(),
  rate: money("Rate").optional(),
  salesValue: money("Sales value").optional(),
  paymentAmount: money("Payment amount").optional(),
  expensesAmount: money("Expenses amount").optional(),
  balance: money("Balance").optional(),
  payerName: optionalString("Payer name", 255),
  bank: optionalString("Bank", 255),
  dateOfPayment: optionalString("Date of payment", 40),
  phoneNumber: optionalString("Phone number", 30),
  remarks: optionalString("Remarks", 1000),
  enteredBy: optionalString("Entered by", 255),
  allocationCode: optionalString("Allocation code", 64),
  paymentMethod: enumOf("Payment method", ["manual", "paystack_dva"]).optional(),
};

const createDeliverySale = z.object({ ...base, truckNumber: requiredString("Truck number", 100) });
const updateDeliverySale = z.object(base).partial();

const listDeliverySales = pagination.extend({
  search: searchTerm,
  customer: searchTerm,
  truck_number: z.string().trim().max(100, "Truck number is too long").optional(),
  date_from: z.string().trim().max(40, "Start date is too long").optional(),
  date_to: z.string().trim().max(40, "End date is too long").optional(),
});

const idParam = z.object({ id: id("Sale id") });

module.exports = { createDeliverySale, updateDeliverySale, listDeliverySales, idParam };
