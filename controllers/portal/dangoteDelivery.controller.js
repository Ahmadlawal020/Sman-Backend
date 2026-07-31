const asyncHandler = require("express-async-handler");
const {
  dangoteDeliveryOrderRepo,
  dangoteDeliveryDocumentRepo,
} = require("../../repositories");
const storage = require("../../services/storage");
const {
  DocumentError,
  uploadDocument,
  removeDocument,
  toPublic,
} = require("../../services/dangoteDelivery/documents");

// Every handler is the signed-in customer acting on their OWN Dangote
// delivery order. Ownership failures are 404s, not 403s — the existence of
// someone else's order is not information a customer should receive.

const loadOwnOrder = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(404).json({ success: false, message: "Order not found" });
    return null;
  }
  const order = await dangoteDeliveryOrderRepo.findById(id);
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

module.exports = {
  uploadMyDocument,
  listMyDocuments,
  removeMyDocument,
  downloadMyDocument,
};
