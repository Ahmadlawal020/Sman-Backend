const z = require("zod");
const { id, quantity, money, requiredString, optionalString, enumOf, pagination, searchTerm } = require("./fields");

const createLpgOrderRequest = z.object({
  customerId: id("Customer id"),
  lpgStationId: id("LPG station id"),
  cylinderSizeKg: z.union(
    [
      z.number().finite(),
      z.string().trim().regex(/^\d+$/, "Cylinder size must be a number").transform(Number),
    ],
    { error: (iss) => iss.input === undefined ? "Cylinder size is required" : "Cylinder size must be a number" }
  ).pipe(z.number().int("Cylinder size must be a whole number").min(1, "Cylinder size must be at least 1 Kg")),
  cylinderQuantity: quantity("Cylinder quantity"),
  deliveryAddress: requiredString("Delivery address", 1000),
  deliveryState: optionalString("Delivery state", 100),
  deliveryLga: optionalString("Delivery LGA", 100),
});

const reviewLpgOrderRequest = z.object({
  action: enumOf("Action", ["approve", "reject"]),
  deliveryPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, "Delivery price must be a valid amount").optional(),
  expectedArrivalDate: optionalString("Expected arrival date", 20),
});

const updateLpgOrderPaymentStatus = z.object({
  paymentStatus: enumOf("Payment status", ["Unpaid", "Paid"]),
});

const updateLpgOrderCollectionStatus = z.object({
  collectionStatus: enumOf("Collection status", ["Pending", "Dispatched", "Collected"]),
});

const listLpgOrderRequests = pagination.extend({
  search: searchTerm,
  status: enumOf("Status", ["Pending Review", "Approved", "Rejected", "Cancelled", "all"]).optional(),
});

const idParam = z.object({ id: id("LPG order request id") });

// The customer portal forces customerId from the token, so the body omits it.
const createMyLpgOrderRequest = createLpgOrderRequest.omit({ customerId: true });

module.exports = {
  createLpgOrderRequest,
  createMyLpgOrderRequest,
  reviewLpgOrderRequest,
  updateLpgOrderPaymentStatus,
  updateLpgOrderCollectionStatus,
  listLpgOrderRequests,
  idParam,
};
