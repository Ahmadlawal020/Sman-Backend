const z = require("zod");
const { id, money, quantity, nonEmptyString, optionalString, pagination } = require("./fields");

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
  truckNumber: optionalString(100),
  dateLoaded: optionalString(40),
  depotLoaded: optionalString(255),
  customerId: id.optional(),
  customerName: optionalString(255),
  location: optionalString(255),
  quantity: quantity.optional(),
  rate: money().optional(),
  salesValue: money().optional(),
  paymentAmount: money().optional(),
  expensesAmount: money().optional(),
  balance: money().optional(),
  payerName: optionalString(255),
  bank: optionalString(255),
  dateOfPayment: optionalString(40),
  phoneNumber: optionalString(30),
  remarks: optionalString(1000),
  enteredBy: optionalString(255),
  allocationCode: optionalString(64),
  paymentMethod: z.enum(["manual", "paystack_dva"]).optional(),
};

const createDeliverySale = z.object({ ...base, truckNumber: nonEmptyString(100) });
const updateDeliverySale = z.object(base).partial();

const listDeliverySales = pagination.extend({
  search: z.string().trim().max(200).optional(),
  customer: z.string().trim().max(200).optional(),
  truck_number: z.string().trim().max(100).optional(),
  date_from: z.string().trim().max(40).optional(),
  date_to: z.string().trim().max(40).optional(),
});

const idParam = z.object({ id });

module.exports = { createDeliverySale, updateDeliverySale, listDeliverySales, idParam };
