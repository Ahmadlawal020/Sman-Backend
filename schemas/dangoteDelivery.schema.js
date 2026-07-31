const z = require("zod");
const { id, quantity, requiredString, optionalString, enumOf } = require("./fields");

// Bodies for the customer Dangote delivery portal. Note what is absent:
// price, totalAmount, status, quantityUnit — all resolved server-side. A
// client-supplied price or unit never reaches a controller.

const contactPhone = z
  .string({ error: () => "Contact phone is required" })
  .trim()
  .transform((v) => v.replace(/[\s\-()]/g, ""))
  .pipe(
    z.string().regex(/^\+?\d{7,15}$/, "Contact phone must be a valid phone number")
  );

const orderDetails = z.object({
  product: enumOf("Product", ["PMS", "AGO", "LPG"]),
  quantity: quantity("Quantity"),
  deliveryAddress: requiredString("Delivery address", 2000),
  deliveryState: requiredString("Delivery state", 100),
  contactPerson: requiredString("Contact person", 255),
  contactPhone,
});

const companyInfo = z.object({
  companyName: requiredString("Company name", 255),
});

const acceptTerms = z.object({
  fullName: requiredString("Full legal name", 255),
  initials: optionalString("Initials", 20),
});

const reuseDocuments = z.object({
  documentIds: z
    .array(id("Document id"))
    .min(1, "Select at least one document to reuse")
    .max(10, "Too many documents"),
});

const reusableCompanyQuery = z.object({
  name: requiredString("Company name", 255),
});

module.exports = {
  orderDetails,
  companyInfo,
  acceptTerms,
  reuseDocuments,
  reusableCompanyQuery,
};
