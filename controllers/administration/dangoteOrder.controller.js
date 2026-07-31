const asyncHandler = require("express-async-handler");
const {
  dangoteProductRepo,
  dangoteOrderRequestRepo,
  customerRepo,
  customerLicenseRepo,
} = require("../../repositories");
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
  const result = await dangoteOrderRequestRepo.findAll({ search, status, page, limit });
  res.json({ success: true, data: result });
});

const getDangoteOrderRequestById = asyncHandler(async (req, res) => {
  const request = await dangoteOrderRequestRepo.findByIdFull(Number(req.params.id));
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
    companyName, licenseId,
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

  const requestNumber = await dangoteOrderRequestRepo.generateRequestNumber();

  const request = await dangoteOrderRequestRepo.create({
    requestNumber,
    customerId: customer.id,
    companyName: companyName || "",
    licenseId: licenseId ? Number(licenseId) : null,
    product,
    quantity: Number(quantity),
    quantityUnit: quantityUnit || "Tons",
    deliveryAddress,
    deliveryState: deliveryState || "",
    deliveryLga: deliveryLga || "",
    status: "Pending Review",
    paymentReference: paymentReference || "",
    paymentMode: paymentMode || "",
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

  const fullRequest = await dangoteOrderRequestRepo.findByIdFull(request.id);

  res.status(201).json({
    success: true,
    message: "Dangote delivery order request submitted successfully",
    data: { request: fullRequest },
  });
});

const reviewDangoteOrderRequest = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { pricePerUnit, deliveryPrice, expectedArrivalDate, action } = req.body;

  const existing = await dangoteOrderRequestRepo.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Order request not found" });
  }

  if (existing.status !== "Pending Review") {
    return res.status(409).json({
      success: false,
      message: `Request is already ${existing.status}`,
    });
  }

  if (action === "reject") {
    const updated = await dangoteOrderRequestRepo.update(id, {
      status: "Rejected",
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
    });
    const fullRequest = await dangoteOrderRequestRepo.findByIdFull(updated.id);
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

  // Check licence status before allowing approval
  if (existing.licenseId) {
    const license = await customerLicenseRepo.findById(existing.licenseId);
    if (license && license.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: "Cannot approve order: the associated licence must be approved first",
      });
    }
  }

  const totalAmount = (Number(pricePerUnit) * existing.quantity) + Number(deliveryPrice || 0);

  const updated = await dangoteOrderRequestRepo.update(id, {
    status: "Approved",
    pricePerUnit: String(pricePerUnit),
    deliveryPrice: String(deliveryPrice || 0),
    totalAmount: String(totalAmount),
    expectedArrivalDate: expectedArrivalDate || "",
    reviewedBy: req.user.id,
    reviewedAt: new Date(),
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
  await dangoteOrderRequestRepo.update(id, {
    virtualAccountNumber,
    virtualAccountBank,
    virtualAccountName,
  });

  const fullRequest = await dangoteOrderRequestRepo.findByIdFull(updated.id);

  // Send confirmation email with DVA payment details
  if (fullRequest.customerEmail) {
    try {
      await sendDangoteOrderConfirmedEmail(fullRequest.customerEmail, {
        requestNumber: fullRequest.requestNumber,
        customerName: fullRequest.customerName,
        companyName: fullRequest.companyName,
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

  const existing = await dangoteOrderRequestRepo.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Order request not found" });
  }

  const updated = await dangoteOrderRequestRepo.update(id, { paymentStatus });
  const fullRequest = await dangoteOrderRequestRepo.findByIdFull(updated.id);

  res.json({
    success: true,
    message: `Payment status updated to ${paymentStatus}`,
    data: { request: fullRequest },
  });
});

const updateDangoteOrderCollectionStatus = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { collectionStatus } = req.body;

  if (!collectionStatus || !["Pending", "Dispatched", "Collected"].includes(collectionStatus)) {
    return res.status(400).json({
      success: false,
      message: "Valid collection status is required (Pending, Dispatched, or Collected)",
    });
  }

  const existing = await dangoteOrderRequestRepo.findById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Order request not found" });
  }

  const updated = await dangoteOrderRequestRepo.update(id, { collectionStatus });
  const fullRequest = await dangoteOrderRequestRepo.findByIdFull(updated.id);

  res.json({
    success: true,
    message: `Collection status updated to ${collectionStatus}`,
    data: { request: fullRequest },
  });
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
};
