const asyncHandler = require("express-async-handler");
const {
  dangoteDeliveryOrderRepo,
  dangoteDeliveryDocumentRepo,
  dangoteDeliveryAgreementRepo,
  customerLicenseRepo,
  customerRepo,
  productRepo,
} = require("../../repositories");
const storage = require("../../services/storage");
const {
  DocumentError,
  verifyDocument,
  rejectDocument,
  toPublic: documentToPublic,
} = require("../../services/dangoteDelivery/documents");
const {
  DangoteOrderError,
  detailColumns,
} = require("../../services/dangoteDelivery/orders");
const {
  quoteAndApprove,
  requestChanges,
  rejectRequest,
  markPaid,
  advanceFulfilment,
} = require("../../services/dangoteDelivery/staff");
const {
  recordEvent,
  TransitionError,
} = require("../../services/dangoteDelivery/transitions");
const {
  sendDangoteRequestReceivedEmail,
} = require("../../services/email.service");
const { emitEvent } = require("../../services/events");

// The staff quote desk. Replaces the legacy /dangote-order-requests
// endpoints: one list/detail surface plus explicit review actions, all
// through the transition service — no free status writes anywhere.

const handleDomainErrors = (err, res) => {
  if (err instanceof DangoteOrderError || err instanceof DocumentError || err instanceof TransitionError) {
    res.status(err.statusCode || 409).json({ success: false, message: err.message });
    return true;
  }
  return false;
};

const loadOrder = async (req, res) => {
  const order = await dangoteDeliveryOrderRepo.findById(Number(req.params.id));
  if (!order) {
    res.status(404).json({ success: false, message: "Order request not found" });
    return null;
  }
  return order;
};

const fullOrder = async (id) => {
  const [order, documents, agreement, events] = await Promise.all([
    dangoteDeliveryOrderRepo.findByIdFull(id),
    dangoteDeliveryDocumentRepo.findByOrder(id),
    dangoteDeliveryAgreementRepo.findByOrder(id),
    dangoteDeliveryOrderRepo.findEventsByOrder(id),
  ]);
  return {
    ...order,
    documents: documents.map(documentToPublic),
    agreement,
    events,
  };
};

const listOrders = asyncHandler(async (req, res) => {
  const { search, status, page = 1, limit = 50 } = req.query;
  const result = await dangoteDeliveryOrderRepo.findAll({ search, status, page, limit });
  res.json({ success: true, data: result });
});

const getOrder = asyncHandler(async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;
  res.json({ success: true, data: { request: await fullOrder(order.id) } });
});

// Staff-created requests (on a customer's behalf) skip the wizard stages and
// land directly under review — the portal flow starts at DRAFT instead.
const createOrder = asyncHandler(async (req, res) => {
  const customer = await customerRepo.findById(req.body.customerId);
  if (!customer) {
    return res.status(404).json({ success: false, message: "Customer not found" });
  }

  try {
    const columns = await detailColumns(productRepo, req.body);
    const requestNumber = await dangoteDeliveryOrderRepo.generateRequestNumber();
    const order = await dangoteDeliveryOrderRepo.create({
      ...columns,
      requestNumber,
      customerId: customer.id,
      status: "UNDER_REVIEW",
      submittedAt: new Date(),
    });
    await recordEvent(order.id, "UNDER_REVIEW", {
      actorType: "staff",
      actorId: req.user.id,
      note: "Created by staff",
    });

    if (customer.email) {
      try {
        await sendDangoteRequestReceivedEmail(customer.email, {
          requestNumber,
          customerName: customer.name,
          product: order.productName,
          quantity: order.quantity,
          quantityUnit: order.quantityUnit,
          deliveryAddress: order.deliveryAddress,
          deliveryState: order.deliveryState,
        });
      } catch (emailErr) {
        console.error("Failed to send Dangote request email:", emailErr.message);
      }
    }

    res.status(201).json({ success: true, data: { request: await fullOrder(order.id) } });
  } catch (err) {
    if (handleDomainErrors(err, res)) return;
    throw err;
  }
});

const approveOrder = asyncHandler(async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;

  try {
    await quoteAndApprove(
      {
        customerRepo,
        orderRepo: dangoteDeliveryOrderRepo,
        licenseRepo: customerLicenseRepo,
      },
      {
        order,
        staffId: req.user.id,
        unitPrice: req.body.unitPrice,
        deliveryPrice: req.body.deliveryPrice,
        expectedArrivalDate: req.body.expectedArrivalDate,
      }
    );
    res.json({
      success: true,
      message: "Quote issued and customer notified",
      data: { request: await fullOrder(order.id) },
    });
  } catch (err) {
    if (handleDomainErrors(err, res)) return;
    throw err;
  }
});

const requestOrderChanges = asyncHandler(async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;

  try {
    await requestChanges({ order, staffId: req.user.id, note: req.body.note });
    res.json({
      success: true,
      message: "Request sent back to the customer",
      data: { request: await fullOrder(order.id) },
    });
  } catch (err) {
    if (handleDomainErrors(err, res)) return;
    throw err;
  }
});

const rejectOrder = asyncHandler(async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;

  try {
    await rejectRequest({ order, staffId: req.user.id, reason: req.body.reason });
    res.json({
      success: true,
      message: "Request rejected",
      data: { request: await fullOrder(order.id) },
    });
  } catch (err) {
    if (handleDomainErrors(err, res)) return;
    throw err;
  }
});

const markOrderPaid = asyncHandler(async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;

  try {
    await markPaid({ order, staffId: req.user.id });
    res.json({
      success: true,
      message: "Payment recorded",
      data: { request: await fullOrder(order.id) },
    });
  } catch (err) {
    if (handleDomainErrors(err, res)) return;
    throw err;
  }
});

const advanceOrderFulfilment = (step) =>
  asyncHandler(async (req, res) => {
    const order = await loadOrder(req, res);
    if (!order) return;

    try {
      const updated = await advanceFulfilment({
        order,
        staffId: req.user.id,
        step,
        note: req.body?.note || "",
      });
      res.json({
        success: true,
        message: `Order is now ${updated.status}`,
        data: { request: await fullOrder(order.id) },
      });
    } catch (err) {
      if (handleDomainErrors(err, res)) return;
      throw err;
    }
  });

// ── Documents ─────────────────────────────────────────────────────────────

const loadOrderDocument = async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return null;
  const doc = await dangoteDeliveryDocumentRepo.findById(Number(req.params.docId));
  if (!doc || doc.orderId !== order.id) {
    res.status(404).json({ success: false, message: "Document not found" });
    return null;
  }
  return { order, doc };
};

const listOrderDocuments = asyncHandler(async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;
  const docs = await dangoteDeliveryDocumentRepo.findByOrder(order.id);
  res.json({ success: true, data: { documents: docs.map(documentToPublic) } });
});

const verifyOrderDocument = asyncHandler(async (req, res) => {
  const loaded = await loadOrderDocument(req, res);
  if (!loaded) return;

  try {
    const updated = await verifyDocument(dangoteDeliveryDocumentRepo, {
      document: loaded.doc,
      staffId: req.user.id,
      expiryDate: req.body.expiryDate,
    });
    res.json({ success: true, message: "Document verified", data: { document: documentToPublic(updated) } });
  } catch (err) {
    if (handleDomainErrors(err, res)) return;
    throw err;
  }
});

const rejectOrderDocument = asyncHandler(async (req, res) => {
  const loaded = await loadOrderDocument(req, res);
  if (!loaded) return;

  const updated = await rejectDocument(dangoteDeliveryDocumentRepo, {
    document: loaded.doc,
    staffId: req.user.id,
    note: req.body.note || "",
  });
  res.json({ success: true, message: "Document rejected", data: { document: documentToPublic(updated) } });
});

const downloadOrderDocument = asyncHandler(async (req, res) => {
  const loaded = await loadOrderDocument(req, res);
  if (!loaded) return;
  const { doc } = loaded;

  // Staff access to customer compliance documents is always audited.
  emitEvent("dangote_delivery.document_downloaded", {
    orderId: doc.orderId,
    documentId: doc.id,
    staffId: req.user.id,
  });

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
  listOrders,
  getOrder,
  createOrder,
  approveOrder,
  requestOrderChanges,
  rejectOrder,
  markOrderPaid,
  advanceOrderFulfilment,
  listOrderDocuments,
  verifyOrderDocument,
  rejectOrderDocument,
  downloadOrderDocument,
};
