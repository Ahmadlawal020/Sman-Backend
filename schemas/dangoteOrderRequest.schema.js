const z = require("zod");
const {
  id,
  quantity,
  requiredString,
  optionalString,
  enumOf,
  pagination,
  searchTerm,
} = require("./fields");

// The customer portal forces customerId from the session, so the create body
// carries only what the wizard collects. Price fields never appear here —
// staff set them at review.
const createMyDangoteOrderRequest = z.object({
  product: requiredString("Product", 255),
  quantity: quantity("Quantity"),
  quantityUnit: enumOf("Quantity unit", ["Tons", "Litres", "Kg"]).optional(),
  deliveryAddress: requiredString("Delivery address", 1000),
  deliveryState: optionalString("Delivery state", 100),
  deliveryLga: optionalString("Delivery LGA", 100),
  companyName: optionalString("Company name", 255),
  licenseId: id("License id").optional(),
});

const listMyDangoteOrderRequests = pagination.extend({
  search: searchTerm,
  status: enumOf("Status", [
    "Pending Review",
    "Approved",
    "Rejected",
    "Cancelled",
    "all",
  ]).optional(),
});

const idParam = z.object({ id: id("Dangote order request id") });

module.exports = {
  createMyDangoteOrderRequest,
  listMyDangoteOrderRequests,
  idParam,
};
