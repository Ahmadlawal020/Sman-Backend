const { transition, recordEvent } = require("./transitions");
const { TERMS_VERSION } = require("./terms");

// Portal-side business rules for the Dangote delivery quote request. Route
// handlers stay thin; everything that must be true regardless of endpoint
// lives here.

// Same map as the frontend's PRODUCT_META — the unit is derived from the
// product code at the API boundary, never taken from the client.
const PRODUCT_UNITS = {
  PMS: "litre",
  AGO: "litre",
  LPG: "kg",
};

class DangoteOrderError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "DangoteOrderError";
    this.statusCode = statusCode;
  }
}

// Byte-for-byte the frontend's normalizeCompanyName (types.ts) — the reuse
// key must match across both sides or document reuse silently breaks.
const normalizeCompanyName = (name) =>
  String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ");

/** Resolve a wizard product code (PMS/AGO/LPG) to the catalog row. */
const resolveProduct = async (productRepo, code) => {
  const unit = PRODUCT_UNITS[code];
  if (!unit) {
    throw new DangoteOrderError(`Unknown product: ${code}`);
  }
  const product = await productRepo.findActiveDangoteByCode(code);
  if (!product) {
    throw new DangoteOrderError(`${code} is not currently available`, 409);
  }
  return { product, unit };
};

const detailColumns = async (productRepo, details) => {
  const { product, unit } = await resolveProduct(productRepo, details.product);
  return {
    productId: product.id,
    productCode: details.product,
    productName: product.name,
    quantity: details.quantity,
    quantityUnit: unit,
    deliveryAddress: details.deliveryAddress,
    deliveryState: details.deliveryState,
    contactPerson: details.contactPerson,
    contactPhone: details.contactPhone,
  };
};

/**
 * DRAFT → DOCUMENTS_SUBMITTED. Requires the license uploaded and the company
 * step completed; the wizard calls this together with acceptTerms at signing.
 */
// DRAFT → DOCUMENTS_SUBMITTED. Requires a linked customer license (verified
// once at the customer level, reused across orders) and the company step done.
const submitDocuments = async ({ order, actor }) => {
  if (order.status !== "DRAFT") {
    throw new DangoteOrderError(`Cannot submit documents for a ${order.status} order`, 409);
  }
  if (!order.licenseId) {
    throw new DangoteOrderError("Attach your DPR/NUPRC license before continuing");
  }
  if (!order.companyName) {
    throw new DangoteOrderError("Company information is required before continuing");
  }
  return transition(order, "DOCUMENTS_SUBMITTED", {
    actorType: actor.type,
    actorId: actor.id,
  });
};

/**
 * DOCUMENTS_SUBMITTED → AGREEMENT_ACCEPTED. Regenerates the agreement
 * snapshot (price-free) with the typed signature; an agreement from before a
 * reopen has already been deleted by then.
 */
const acceptTerms = async (agreementRepo, { order, customer, signature, userAgent, actor }) => {
  if (order.status !== "DOCUMENTS_SUBMITTED") {
    throw new DangoteOrderError(`Cannot sign a ${order.status} order`, 409);
  }

  await agreementRepo.deleteByOrder(order.id);
  const agreement = await agreementRepo.create({
    orderId: order.id,
    customerName: customer.name || signature.fullName,
    companyName: order.companyName || "",
    deliveryAddress: order.deliveryAddress,
    deliveryState: order.deliveryState || "",
    productCode: order.productCode || "",
    productName: order.productName,
    quantity: order.quantity,
    quantityUnit: order.quantityUnit,
    signatureFullName: signature.fullName,
    signatureInitials: signature.initials || "",
    signedAt: new Date(),
    termsVersion: TERMS_VERSION,
    userAgent: (userAgent || "").slice(0, 1000),
  });

  const updated = await transition(order, "AGREEMENT_ACCEPTED", {
    actorType: actor.type,
    actorId: actor.id,
  });

  return { order: updated, agreement };
};

/** AGREEMENT_ACCEPTED → UNDER_REVIEW (the actual quote-request submission). */
const submitRequest = async ({ order, actor }) => {
  if (order.status !== "AGREEMENT_ACCEPTED") {
    throw new DangoteOrderError(`Cannot submit a ${order.status} order`, 409);
  }
  return transition(order, "UNDER_REVIEW", {
    actorType: actor.type,
    actorId: actor.id,
  });
};

/**
 * NEEDS_CHANGES → DRAFT. The old agreement is invalidated — the customer must
 * re-sign against whatever they change.
 */
const reopenForChanges = async (agreementRepo, { order, actor }) => {
  if (order.status !== "NEEDS_CHANGES") {
    throw new DangoteOrderError(`Cannot reopen a ${order.status} order`, 409);
  }
  await agreementRepo.deleteByOrder(order.id);
  const updated = await transition(order, "DRAFT", {
    actorType: actor.type,
    actorId: actor.id,
    note: "Reopened for changes",
  });
  await recordEvent(order.id, "AGREEMENT_INVALIDATED", {
    actorType: actor.type,
    actorId: actor.id,
    note: "Re-signature required after reopen",
  });
  return updated;
};

module.exports = {
  PRODUCT_UNITS,
  DangoteOrderError,
  normalizeCompanyName,
  resolveProduct,
  detailColumns,
  submitDocuments,
  acceptTerms,
  submitRequest,
  reopenForChanges,
};
