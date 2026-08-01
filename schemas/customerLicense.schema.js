const z = require("zod");
const {
  id,
  requiredString,
  optionalString,
  enumOf,
  searchTerm,
  pagination,
} = require("./fields");

// Customer (portal) — create accepts either a multipart file (backend mode)
// or a client-reported direct upload (cloudinary mode). Validation of the file
// itself happens server-side in the service; here we only shape the fields.
const createLicense = z.object({
  companyName: requiredString("Company name", 255),
  publicId: optionalString("Upload reference", 500),
  resourceType: optionalString("Resource type", 20),
  fileName: optionalString("File name", 255),
});

const reusableQuery = z.object({
  company: requiredString("Company name", 255),
});

// Staff registry
const staffList = pagination.extend({
  status: enumOf("Status", ["PENDING", "VERIFIED", "REJECTED", "all"]).optional(),
  search: searchTerm,
  customerId: id("Customer id").optional(),
});

const verifyLicense = z.object({
  expiryDate: requiredString("Expiry date", 20),
});

const rejectLicense = z.object({
  comment: optionalString("Comment", 2000),
});

const linkLicense = z.object({
  licenseId: id("License id"),
});

module.exports = {
  createLicense,
  reusableQuery,
  staffList,
  verifyLicense,
  rejectLicense,
  linkLicense,
};
