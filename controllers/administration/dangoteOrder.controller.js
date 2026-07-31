const asyncHandler = require("express-async-handler");
const {
  dangoteProductRepo,
  dangoteDeliveryOrderRepo,
  dangoteDeliveryDocumentRepo,
  customerRepo,
} = require("../../repositories");
const storage = require("../../services/storage");
const {
  DocumentError,
  verifyDocument,
  rejectDocument,
  toPublic: documentToPublic,
} = require("../../services/dangoteDelivery/documents");
const { emitEvent } = require("../../services/events");
const {
  transition,
  recordEvent,
  TransitionError,
} = require("../../services/dangoteDelivery/transitions");
const {
  sendDangoteRequestReceivedEmail,
  sendDangoteOrderConfirmedEmail,
} = require("../../services/email.service");
const { createDedicatedAccount } = require("../../services/payment.service");
const { sendDangoteDeliveryOrderSMS } = require("../../services/sms.service");
const { getCustomerInitials } = require("../../utils/helpers");

// ── Dangote Products ──────────────────────────────────────────────────────

const getDangoteProducts = asyncHandler(async (req, res) => {
  const { search, status, page = 1, limit = 50 } = req.query;
  const result = await dangoteProductRepo.findAll({ search, status, page, limit });
  res.json({ success: true, data: result });
});

const getDangoteProductsActive = asyncHandler(async (req, res) => {
  const products = await dangoteProductRepo.findAllActive();
  res.json({ success: true, data: { products } });
});

const getDangoteProductById = asyncHandler(async (req, res) => {
  const product = await dangoteProductRepo.findById(Number(req.params.id));
  if (!product) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }
  res.json({ success: true, data: { product } });
});

const createDangoteProduct = asyncHandler(async (req, res) => {
  const { name, sku, category, unit, description, plants, status } = req.body;

  if (!name || !sku || !category) {
    return res.status(400).json({
      success: false,
      message: "Name, SKU, and category are required",
    });
  }

  const product = await dangoteProductRepo.create({
    name,
    sku: sku.toUpperCase(),
    category,
    unit: unit || "Tons",
    description: description || "",
    plants: typeof plants === "string" ? plants : JSON.stringify(plants || []),
    status: status || "Active",
  });

  res.status(201).json({ success: true, message: "Product created", data: { product } });
});

const updateDangoteProduct = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await dangoteProductRepo.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  const updateData = { ...req.body };
  if (updateData.sku) updateData.sku = updateData.sku.toUpperCase();
  if (updateData.plants && typeof updateData.plants !== "string") {
    updateData.plants = JSON.stringify(updateData.plants);
  }

  const product = await dangoteProductRepo.update(id, updateData);
  res.json({ success: true, message: "Product updated", data: { product } });
});

// ── Dangote Order Requests ────────────────────────────────────────────────

const getDangoteOrderRequests = asyncHandler(async (req, res) => {
  const { search, status, page = 1, limit = 50 } = req.query;
  const result = await dangoteDeliveryOrderRepo.findAll({ search, status, page, limit });
  res.json({ success: true, data: result });
});

const getDangoteOrderRequestById = asyncHandler(async (req, res) => {
  const request = await dangoteDeliveryOrderRepo.findByIdFull(Number(req.params.id));
  if (!request) {
    return res.status(404).json({ success: false, message: "Order request not found" });
  }
  res.json({ success: true, data: { request } });
});

const createDangoteOrderRequest = asyncHandler(async (req, res) => {
  const {
    customerId, product, quantity, quantityUnit,
    deliveryAddress, deliveryState, deliveryLga,
    paymentReference, paymentMode,
  } = req.body;

  if (!customerId || !product || !quantity || !deliveryAddress) {
    return res.status(400).json({
      success: false,
      message: "Customer, product, quantity, and delivery address are required",
    });
  }

  const customer = await customerRepo.findById(Number(customerId));
  if (!customer) {
    return res.status(404).json({ success: false, message: "Customer not found" });
  }

  const requestNumber = await dangoteDeliveryOrderRepo.generateRequestNumber();

  // Staff-created requests skip the customer wizard stages and land directly
  // under review; the customer portal flow (B5) starts at DRAFT instead.
  const request = await dangoteDeliveryOrderRepo.create({
    requestNumber,
    customerId: customer.id,
    productName: product,
    quantity: Number(quantity),
    quantityUnit: quantityUnit || "Tons",
    deliveryAddress,
    deliveryState: deliveryState || "",
    deliveryLga: deliveryLga || "",
    status: "UNDER_REVIEW",
    submittedAt: new Date(),
    paymentReference: paymentReference || "",
    paymentMode: paymentMode || "",
  });

  await recordEvent(request.id, "UNDER_REVIEW", {
    actorType: "staff",
    actorId: req.user.id,
    note: "Created by staff",
  });

  // Send "under review" email to customer
  if (customer.email) {
    try {
      await sendDangoteRequestReceivedEmail(customer.email, {
        requestNumber,
        customerName: customer.name,
        product,
        quantity: Number(quantity),
        quantityUnit: quantityUnit || "Tons",
        deliveryAddress,
        deliveryState,
      });
    } catch (emailErr) {
      console.error("Failed to send Dangote request email:", emailErr);
    }
  }

  const fullRequest = await dangoteDeliveryOrderRepo.findByIdFull(request.id);

  res.status(201).json({
    success: true,
    message: "Dangote delivery order request submitted successfully",
    data: { request: fullRequest },
  });
});

const reviewDangoteOrderRequest = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { pricePerUnit, deliveryPrice, expectedArrivalDate, action } = req.body;

  const existing = await dangoteDeliveryOrderRepo.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Order request not found" });
  }

  if (existing.status !== "UNDER_REVIEW") {
    return res.status(409).json({
      success: false,
      message: `Request is already ${existing.status}`,
    });
  }

  if (action === "reject") {
    const updated = await transition(existing, "REJECTED", {
      actorType: "staff",
      actorId: req.user.id,
      set: { reviewedBy: req.user.id, reviewedAt: new Date() },
    });
    const fullRequest = await dangoteDeliveryOrderRepo.findByIdFull(updated.id);
    return res.json({
      success: true,
      message: "Order request rejected",
      data: { request: fullRequest },
    });
  }

  // Approve
  if (!pricePerUnit) {
    return res.status(400).json({
      success: false,
      message: "Price per unit is required for approval",
    });
  }

  const totalAmount = (Number(pricePerUnit) * existing.quantity) + Number(deliveryPrice || 0);

  const updated = await transition(existing, "APPROVED", {
    actorType: "staff",
    actorId: req.user.id,
    set: {
      unitPrice: String(pricePerUnit),
      deliveryPrice: String(deliveryPrice || 0),
      totalAmount: String(totalAmount),
      expectedArrivalDate: expectedArrivalDate || "",
      quotedBy: req.user.id,
      quotedAt: new Date(),
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
    },
  });

  // Fetch full customer record for DVA check
  const customer = await customerRepo.findById(existing.customerId);

  // Check/create DVA (Dedicated Virtual Account)
  let virtualAccountNumber = customer?.virtualAccountNumber || "";
  let virtualAccountBank = customer?.virtualAccountBank || "";
  let virtualAccountName = customer?.virtualAccountName || "";

  if (!virtualAccountNumber && customer) {
    try {
      const accountResult = await createDedicatedAccount(customer);
      if (accountResult.success) {
        virtualAccountNumber = accountResult.data.accountNumber;
        virtualAccountBank = accountResult.data.bankName;
        virtualAccountName =
          accountResult.data.accountName ||
          `SOROMANNIGERI/ ${getCustomerInitials(customer.name)}`;
        const updateData = {
          virtualAccountNumber,
          virtualAccountBank,
          virtualAccountName,
        };
        if (accountResult.data.paystackCustomerId) {
          updateData.paystackCustomerId = accountResult.data.paystackCustomerId;
        }
        await customerRepo.update(customer.id, updateData);
      } else {
        console.error("Failed to create DVA for customer:", accountResult.message);
      }
    } catch (dvaErr) {
      console.error("DVA creation error:", dvaErr.message);
    }
  } else if (!virtualAccountName && customer) {
    virtualAccountName = `SOROMANNIGERI/ ${getCustomerInitials(customer.name)}`;
    await customerRepo.update(customer.id, { virtualAccountName });
  }

  // Store DVA on the request record
  await dangoteDeliveryOrderRepo.update(id, {
    virtualAccountNumber,
    virtualAccountBank,
    virtualAccountName,
  });

  const fullRequest = await dangoteDeliveryOrderRepo.findByIdFull(updated.id);

  // Send confirmation email with DVA payment details
  if (fullRequest.customerEmail) {
    try {
      await sendDangoteOrderConfirmedEmail(fullRequest.customerEmail, {
        requestNumber: fullRequest.requestNumber,
        customerName: fullRequest.customerName,
        companyName: fullRequest.companyName || fullRequest.customerCompanyName || "",
        customerPhone: fullRequest.customerPhone,
        product: fullRequest.product,
        quantity: fullRequest.quantity,
        quantityUnit: fullRequest.quantityUnit,
        pricePerUnit: Number(pricePerUnit),
        deliveryPrice: Number(deliveryPrice || 0),
        totalAmount,
        deliveryAddress: fullRequest.deliveryAddress,
        deliveryState: fullRequest.deliveryState,
        expectedArrivalDate: expectedArrivalDate || "",
        accountNumber: virtualAccountNumber,
        bankName: virtualAccountBank,
        accountName: virtualAccountName,
      });
    } catch (emailErr) {
      console.error("Failed to send Dangote confirmation email:", emailErr);
    }
  }

  // Send SMS with order summary and payment details
  if (customer?.phone) {
    try {
      await sendDangoteDeliveryOrderSMS(customer.phone, {
        requestNumber: fullRequest.requestNumber,
        customerName: fullRequest.customerName,
        product: fullRequest.product,
        quantity: fullRequest.quantity,
        quantityUnit: fullRequest.quantityUnit,
        totalAmount,
        accountNumber: virtualAccountNumber,
        bankName: virtualAccountBank,
        accountName: virtualAccountName,
      });
    } catch (smsErr) {
      console.error("Failed to send Dangote delivery SMS:", smsErr);
    }
  }

  res.json({
    success: true,
    message: "Order request approved, confirmation email and SMS sent",
    data: { request: fullRequest },
  });
});

const updateDangoteOrderPaymentStatus = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { paymentStatus } = req.body;

  if (!paymentStatus || !["Unpaid", "Paid"].includes(paymentStatus)) {
    return res.status(400).json({
      success: false,
      message: "Valid payment status is required (Unpaid or Paid)",
    });
  }

  const existing = await dangoteDeliveryOrderRepo.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Order request not found" });
  }

  if (paymentStatus === "Unpaid") {
    return res.status(409).json({
      success: false,
      message: "A payment cannot be reversed; use the review flow instead",
    });
  }

  try {
    // Legacy manual toggle walks the machine: APPROVED → PAYMENT_PENDING → PAID.
    let order = existing;
    if (order.status === "APPROVED") {
      order = await transition(order, "PAYMENT_PENDING", {
        actorType: "staff",
        actorId: req.user.id,
      });
    }
    await transition(order, "PAID", {
      actorType: "staff",
      actorId: req.user.id,
      note: "Payment confirmed manually by staff",
    });
  } catch (err) {
    if (err instanceof TransitionError) {
      return res.status(409).json({ success: false, message: err.message });
    }
    throw err;
  }

  const fullRequest = await dangoteDeliveryOrderRepo.findByIdFull(id);

  res.json({
    success: true,
    message: "Payment status updated to Paid",
    data: { request: fullRequest },
  });
});

const updateDangoteOrderCollectionStatus = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { collectionStatus } = req.body;

  if (!collectionStatus || !["Dispatched", "Collected"].includes(collectionStatus)) {
    return res.status(400).json({
      success: false,
      message: "Valid collection status is required (Dispatched or Collected)",
    });
  }

  const existing = await dangoteDeliveryOrderRepo.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Order request not found" });
  }

  try {
    // Legacy manual toggle walks the machine to the requested stage:
    // PAID → SCHEDULED → DISPATCHED (→ COMPLETED for "Collected").
    const target = collectionStatus === "Collected" ? "COMPLETED" : "DISPATCHED";
    const path = { PAID: ["SCHEDULED"], SCHEDULED: [], DISPATCHED: [] };
    let order = existing;
    for (const step of path[order.status] || []) {
      order = await transition(order, step, { actorType: "staff", actorId: req.user.id });
    }
    if (order.status === "SCHEDULED") {
      order = await transition(order, "DISPATCHED", { actorType: "staff", actorId: req.user.id });
    }
    if (target === "COMPLETED" && order.status === "DISPATCHED") {
      order = await transition(order, "COMPLETED", { actorType: "staff", actorId: req.user.id });
    }
    if (order.status !== target) {
      return res.status(409).json({
        success: false,
        message: `Cannot move a ${existing.status} order to ${target}`,
      });
    }
  } catch (err) {
    if (err instanceof TransitionError) {
      return res.status(409).json({ success: false, message: err.message });
    }
    throw err;
  }

  const fullRequest = await dangoteDeliveryOrderRepo.findByIdFull(id);

  res.json({
    success: true,
    message: `Collection status updated to ${collectionStatus}`,
    data: { request: fullRequest },
  });
});

// ── Documents (staff review side) ─────────────────────────────────────────

const loadOrderDocument = async (req, res) => {
  const order = await dangoteDeliveryOrderRepo.findById(Number(req.params.id));
  if (!order) {
    res.status(404).json({ success: false, message: "Order request not found" });
    return null;
  }
  const doc = await dangoteDeliveryDocumentRepo.findById(Number(req.params.docId));
  if (!doc || doc.orderId !== order.id) {
    res.status(404).json({ success: false, message: "Document not found" });
    return null;
  }
  return { order, doc };
};

const getDangoteOrderDocuments = asyncHandler(async (req, res) => {
  const order = await dangoteDeliveryOrderRepo.findById(Number(req.params.id));
  if (!order) {
    return res.status(404).json({ success: false, message: "Order request not found" });
  }
  const docs = await dangoteDeliveryDocumentRepo.findByOrder(order.id);
  res.json({ success: true, data: { documents: docs.map(documentToPublic) } });
});

const verifyDangoteOrderDocument = asyncHandler(async (req, res) => {
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
    if (err instanceof DocumentError) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    throw err;
  }
});

const rejectDangoteOrderDocument = asyncHandler(async (req, res) => {
  const loaded = await loadOrderDocument(req, res);
  if (!loaded) return;

  const updated = await rejectDocument(dangoteDeliveryDocumentRepo, {
    document: loaded.doc,
    staffId: req.user.id,
    note: req.body.note || "",
  });
  res.json({ success: true, message: "Document rejected", data: { document: documentToPublic(updated) } });
});

const downloadDangoteOrderDocument = asyncHandler(async (req, res) => {
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
  getDangoteProducts,
  getDangoteProductsActive,
  getDangoteProductById,
  createDangoteProduct,
  updateDangoteProduct,
  getDangoteOrderRequests,
  getDangoteOrderRequestById,
  createDangoteOrderRequest,
  reviewDangoteOrderRequest,
  updateDangoteOrderPaymentStatus,
  updateDangoteOrderCollectionStatus,
  getDangoteOrderDocuments,
  verifyDangoteOrderDocument,
  rejectDangoteOrderDocument,
  downloadDangoteOrderDocument,
};
