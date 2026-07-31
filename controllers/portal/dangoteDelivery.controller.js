const asyncHandler = require("express-async-handler");
const {
  dangoteDeliveryOrderRepo,
  dangoteDeliveryDocumentRepo,
  dangoteDeliveryAgreementRepo,
  productRepo,
} = require("../../repositories");
const storage = require("../../services/storage");
const {
  DocumentError,
  uploadDocument,
  removeDocument,
  reuseDocuments,
  toPublic,
} = require("../../services/dangoteDelivery/documents");
const {
  DangoteOrderError,
  normalizeCompanyName,
  detailColumns,
  submitDocuments,
  acceptTerms,
  submitRequest,
  reopenForChanges,
} = require("../../services/dangoteDelivery/orders");
const {
  TERMS_VERSION,
  TERMS_TITLE,
  TERMS_EFFECTIVE,
  TERMS_SECTIONS,
} = require("../../services/dangoteDelivery/terms");
const {
  transition,
  recordEvent,
  TransitionError,
} = require("../../services/dangoteDelivery/transitions");

// Frontend CANCELLABLE_STATUSES, verbatim.
const CANCELLABLE_STATUSES = [
  "DRAFT",
  "DOCUMENTS_SUBMITTED",
  "AGREEMENT_ACCEPTED",
  "UNDER_REVIEW",
  "NEEDS_CHANGES",
  "APPROVED",
  "PAYMENT_PENDING",
];

const handleDomainErrors = (err, res) => {
  if (err instanceof DangoteOrderError || err instanceof DocumentError || err instanceof TransitionError) {
    res.status(err.statusCode || 409).json({ success: false, message: err.message });
    return true;
  }
  return false;
};

// What the portal exposes of an order row — staff-only fields stay behind.
const orderToPublic = (order) => ({
  id: order.id,
  requestNumber: order.requestNumber,
  product: order.productCode,
  productName: order.productName,
  quantity: order.quantity,
  quantityUnit: order.quantityUnit,
  deliveryAddress: order.deliveryAddress,
  deliveryState: order.deliveryState,
  contactPerson: order.contactPerson,
  contactPhone: order.contactPhone,
  companyName: order.companyName,
  companyNameNormalized: order.companyNameNormalized,
  status: order.status,
  unitPrice: order.unitPrice,
  totalAmount: order.totalAmount,
  virtualAccountNumber: order.virtualAccountNumber,
  virtualAccountBank: order.virtualAccountBank,
  virtualAccountName: order.virtualAccountName,
  submittedAt: order.submittedAt,
  approvedAt: order.approvedAt,
  quotedAt: order.quotedAt,
  paidAt: order.paidAt,
  scheduledAt: order.scheduledAt,
  dispatchedAt: order.dispatchedAt,
  completedAt: order.completedAt,
  cancelledAt: order.cancelledAt,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
});

const agreementToPublic = (agreement) =>
  agreement && {
    id: agreement.id,
    customerName: agreement.customerName,
    companyName: agreement.companyName,
    deliveryAddress: agreement.deliveryAddress,
    deliveryState: agreement.deliveryState,
    productCode: agreement.productCode,
    productName: agreement.productName,
    quantity: agreement.quantity,
    quantityUnit: agreement.quantityUnit,
    signature: {
      fullName: agreement.signatureFullName,
      initials: agreement.signatureInitials || undefined,
      signedAt: agreement.signedAt,
      termsVersion: agreement.termsVersion,
    },
    createdAt: agreement.createdAt,
  };

const orderWithChildren = async (order) => {
  const [documents, agreement, events] = await Promise.all([
    dangoteDeliveryDocumentRepo.findByOrder(order.id),
    dangoteDeliveryAgreementRepo.findByOrder(order.id),
    dangoteDeliveryOrderRepo.findEventsByOrder(order.id),
  ]);
  return {
    ...orderToPublic(order),
    documents: documents.map(toPublic),
    agreement: agreementToPublic(agreement),
    events,
  };
};

// Every handler is the signed-in customer acting on their OWN Dangote
// delivery order. Ownership failures are 404s, not 403s — the existence of
// someone else's order is not information a customer should receive.

const loadOwnOrder = async (req, res) => {
  // The id param accepts either the row id or the customer-facing request
  // number (DNG-YYYY-NNNNN) — the portal uses the reference as its order id.
  const param = String(req.params.id || "");
  let order = null;
  if (/^\d+$/.test(param)) {
    order = await dangoteDeliveryOrderRepo.findById(Number(param));
  } else if (/^DNG-/i.test(param)) {
    order = await dangoteDeliveryOrderRepo.findByRequestNumber(param.toUpperCase());
  }
  if (!order || order.customerId !== req.customer.id) {
    res.status(404).json({ success: false, message: "Order not found" });
    return null;
  }
  return order;
};

const uploadMyDocument = asyncHandler(async (req, res) => {
  const order = await loadOwnOrder(req, res);
  if (!order) return;

  if (order.status !== "DRAFT") {
    return res.status(409).json({
      success: false,
      message: "Documents can only be changed while the request is a draft",
    });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: "A file is required" });
  }

  const documentType = req.body.documentType || "DPR_NUPRC_LICENSE";

  try {
    const doc = await uploadDocument(dangoteDeliveryDocumentRepo, {
      order,
      file: req.file,
      documentType,
      actor: { type: "customer", id: req.customer.id },
    });
    res.status(201).json({ success: true, data: { document: toPublic(doc) } });
  } catch (err) {
    if (err instanceof DocumentError) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    throw err;
  }
});

const listMyDocuments = asyncHandler(async (req, res) => {
  const order = await loadOwnOrder(req, res);
  if (!order) return;

  const docs = await dangoteDeliveryDocumentRepo.findByOrder(order.id);
  res.json({ success: true, data: { documents: docs.map(toPublic) } });
});

const removeMyDocument = asyncHandler(async (req, res) => {
  const order = await loadOwnOrder(req, res);
  if (!order) return;

  if (order.status !== "DRAFT") {
    return res.status(409).json({
      success: false,
      message: "Documents can only be changed while the request is a draft",
    });
  }

  const doc = await dangoteDeliveryDocumentRepo.findById(Number(req.params.docId));
  if (!doc || doc.orderId !== order.id) {
    return res.status(404).json({ success: false, message: "Document not found" });
  }

  await removeDocument(dangoteDeliveryDocumentRepo, {
    order,
    document: doc,
    actor: { type: "customer", id: req.customer.id },
  });

  res.json({ success: true, message: "Document removed" });
});

const downloadMyDocument = asyncHandler(async (req, res) => {
  const order = await loadOwnOrder(req, res);
  if (!order) return;

  const doc = await dangoteDeliveryDocumentRepo.findById(Number(req.params.docId));
  if (!doc || doc.orderId !== order.id) {
    return res.status(404).json({ success: false, message: "Document not found" });
  }

  // Presigned URL when the driver can mint one (S3) — generated per request,
  // ~5 minute TTL, never stored. Local driver streams through the API.
  const url = await storage.presignGet(doc.storageKey, 300);
  if (url) {
    return res.redirect(302, url);
  }

  const { stream, contentLength } = await storage.getStream(doc.storageKey);
  res.setHeader("Content-Type", doc.mimeType);
  if (contentLength) res.setHeader("Content-Length", contentLength);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${doc.fileName.replace(/[^\w.\- ]/g, "_")}"`
  );
  stream.pipe(res);
});

// ── Wizard lifecycle (B5) ─────────────────────────────────────────────────

const createMyDraft = asyncHandler(async (req, res) => {
  try {
    const columns = await detailColumns(productRepo, req.body);
    const requestNumber = await dangoteDeliveryOrderRepo.generateRequestNumber();
    const order = await dangoteDeliveryOrderRepo.create({
      ...columns,
      requestNumber,
      customerId: req.customer.id,
      status: "DRAFT",
    });
    await recordEvent(order.id, "DRAFT", {
      actorType: "customer",
      actorId: req.customer.id,
      note: "Draft created",
    });
    res.status(201).json({ success: true, data: { order: await orderWithChildren(order) } });
  } catch (err) {
    if (handleDomainErrors(err, res)) return;
    throw err;
  }
});

const listMyOrders = asyncHandler(async (req, res) => {
  const { requests } = await dangoteDeliveryOrderRepo.findAll({
    customerId: req.customer.id,
    limit: 100,
  });
  // List rows come from the summary projection; they already omit staff-only
  // fields, so pass them through with the frontend's field names.
  res.json({
    success: true,
    data: {
      orders: requests.map((r) => ({
        id: r.id,
        requestNumber: r.requestNumber,
        product: r.productCode,
        productName: r.product,
        quantity: r.quantity,
        quantityUnit: r.quantityUnit,
        companyName: r.companyName,
        deliveryAddress: r.deliveryAddress,
        deliveryState: r.deliveryState,
        status: r.status,
        unitPrice: r.unitPrice,
        totalAmount: r.totalAmount,
        submittedAt: r.submittedAt,
        createdAt: r.createdAt,
      })),
    },
  });
});

const getMyOrder = asyncHandler(async (req, res) => {
  const order = await loadOwnOrder(req, res);
  if (!order) return;
  res.json({ success: true, data: { order: await orderWithChildren(order) } });
});

const updateMyDetails = asyncHandler(async (req, res) => {
  const order = await loadOwnOrder(req, res);
  if (!order) return;

  if (order.status !== "DRAFT") {
    return res.status(409).json({
      success: false,
      message: "Details can only be changed while the request is a draft",
    });
  }

  try {
    const columns = await detailColumns(productRepo, req.body);
    const updated = await dangoteDeliveryOrderRepo.update(order.id, columns);
    res.json({ success: true, data: { order: await orderWithChildren(updated) } });
  } catch (err) {
    if (handleDomainErrors(err, res)) return;
    throw err;
  }
});

const setMyCompany = asyncHandler(async (req, res) => {
  const order = await loadOwnOrder(req, res);
  if (!order) return;

  if (order.status !== "DRAFT") {
    return res.status(409).json({
      success: false,
      message: "Company information can only be changed while the request is a draft",
    });
  }

  const companyName = req.body.companyName.trim();
  const updated = await dangoteDeliveryOrderRepo.update(order.id, {
    companyName,
    companyNameNormalized: normalizeCompanyName(companyName),
  });
  res.json({ success: true, data: { order: await orderWithChildren(updated) } });
});

// The one-tap reuse offer: this customer's verified, unexpired documents for
// the same normalized company name.
const findMyReusableCompany = asyncHandler(async (req, res) => {
  const normalized = normalizeCompanyName(req.query.name);
  const docs = await dangoteDeliveryDocumentRepo.findReusable(req.customer.id, normalized);
  if (docs.length === 0) {
    return res.json({ success: true, data: { company: null } });
  }
  res.json({
    success: true,
    data: {
      company: {
        companyName: req.query.name,
        documents: docs.map(toPublic),
      },
    },
  });
});

const reuseMyDocuments = asyncHandler(async (req, res) => {
  const order = await loadOwnOrder(req, res);
  if (!order) return;

  if (order.status !== "DRAFT") {
    return res.status(409).json({
      success: false,
      message: "Documents can only be changed while the request is a draft",
    });
  }

  // Every requested document must be one this customer could legitimately
  // reuse for this order's company: theirs, VERIFIED, unexpired, same
  // normalized company. The reusable query is the single source of that rule.
  const reusable = await dangoteDeliveryDocumentRepo.findReusable(
    req.customer.id,
    order.companyNameNormalized
  );
  const allowed = new Map(reusable.map((d) => [d.id, d]));
  const chosen = [];
  for (const docId of req.body.documentIds) {
    const doc = allowed.get(docId);
    if (!doc) {
      return res.status(400).json({
        success: false,
        message: "One or more documents are not available for reuse",
      });
    }
    chosen.push(doc);
  }

  const copies = await reuseDocuments(dangoteDeliveryDocumentRepo, {
    order,
    documents: chosen,
    actor: { type: "customer", id: req.customer.id },
  });

  res.json({ success: true, data: { documents: copies.map(toPublic) } });
});

const submitMyDocuments = asyncHandler(async (req, res) => {
  const order = await loadOwnOrder(req, res);
  if (!order) return;

  try {
    const documents = await dangoteDeliveryDocumentRepo.findByOrder(order.id);
    const updated = await submitDocuments({
      order,
      documents,
      actor: { type: "customer", id: req.customer.id },
    });
    res.json({ success: true, data: { order: await orderWithChildren(updated) } });
  } catch (err) {
    if (handleDomainErrors(err, res)) return;
    throw err;
  }
});

const getTerms = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      version: TERMS_VERSION,
      title: TERMS_TITLE,
      effective: TERMS_EFFECTIVE,
      sections: TERMS_SECTIONS,
    },
  });
});

const acceptMyTerms = asyncHandler(async (req, res) => {
  const order = await loadOwnOrder(req, res);
  if (!order) return;

  try {
    const { order: updated } = await acceptTerms(dangoteDeliveryAgreementRepo, {
      order,
      customer: req.customer,
      signature: { fullName: req.body.fullName.trim(), initials: (req.body.initials || "").trim() },
      userAgent: req.headers["user-agent"] || "",
      actor: { type: "customer", id: req.customer.id },
    });
    res.json({ success: true, data: { order: await orderWithChildren(updated) } });
  } catch (err) {
    if (handleDomainErrors(err, res)) return;
    throw err;
  }
});

const submitMyRequest = asyncHandler(async (req, res) => {
  const order = await loadOwnOrder(req, res);
  if (!order) return;

  try {
    const updated = await submitRequest({
      order,
      actor: { type: "customer", id: req.customer.id },
    });
    res.json({ success: true, data: { order: await orderWithChildren(updated) } });
  } catch (err) {
    if (handleDomainErrors(err, res)) return;
    throw err;
  }
});

const reopenMyOrder = asyncHandler(async (req, res) => {
  const order = await loadOwnOrder(req, res);
  if (!order) return;

  try {
    const updated = await reopenForChanges(dangoteDeliveryAgreementRepo, {
      order,
      actor: { type: "customer", id: req.customer.id },
    });
    res.json({ success: true, data: { order: await orderWithChildren(updated) } });
  } catch (err) {
    if (handleDomainErrors(err, res)) return;
    throw err;
  }
});

const cancelMyOrder = asyncHandler(async (req, res) => {
  const order = await loadOwnOrder(req, res);
  if (!order) return;

  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    return res.status(409).json({
      success: false,
      message: "Paid orders can no longer be cancelled",
    });
  }

  try {
    const updated = await transition(order, "CANCELLED", {
      actorType: "customer",
      actorId: req.customer.id,
    });
    res.json({ success: true, data: { order: await orderWithChildren(updated) } });
  } catch (err) {
    if (handleDomainErrors(err, res)) return;
    throw err;
  }
});

module.exports = {
  uploadMyDocument,
  listMyDocuments,
  removeMyDocument,
  downloadMyDocument,
  createMyDraft,
  listMyOrders,
  getMyOrder,
  updateMyDetails,
  setMyCompany,
  findMyReusableCompany,
  reuseMyDocuments,
  submitMyDocuments,
  getTerms,
  acceptMyTerms,
  submitMyRequest,
  reopenMyOrder,
  cancelMyOrder,
};
