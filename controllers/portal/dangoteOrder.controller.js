const asyncHandler = require("express-async-handler");
const {
  dangoteProductRepo,
  dangoteOrderRequestRepo,
  customerRepo,
  customerLicenseRepo,
} = require("../../repositories");
const { sendDangoteRequestReceivedEmail } = require("../../services/email.service");

/**
 * GET /api/dangote-catalog — public, read-only: the active Dangote products a
 * customer can request a bulk quote for. The customer-facing sibling of the
 * staff /api/dangote-products endpoints, trimmed to what the wizard shows.
 */
const getDangoteCatalog = asyncHandler(async (req, res) => {
  const products = await dangoteProductRepo.findAllActive();
  res.json({
    success: true,
    data: {
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        unit: p.unit,
        description: p.description,
      })),
    },
  });
});

/**
 * POST /api/customer/dangote-orders — the signed-in customer submits their OWN
 * bulk quote request. The customer id comes from the session, never the body.
 * It lands as Pending Review; staff review, price, and approve it through the
 * existing admin flow, which also provisions the payment account.
 */
const createMyDangoteOrder = asyncHandler(async (req, res) => {
  const {
    product,
    quantity,
    quantityUnit,
    deliveryAddress,
    deliveryState,
    deliveryLga,
    companyName,
    licenseId,
  } = req.body;

  // A license can only be attached from the customer's OWN register — a
  // foreign id is indistinguishable from a typo, so both get the same 400.
  if (licenseId) {
    const license = await customerLicenseRepo.findById(Number(licenseId));
    if (!license || license.customerId !== req.customer.id) {
      return res.status(400).json({ success: false, message: "License not found" });
    }
  }

  const requestNumber = await dangoteOrderRequestRepo.generateRequestNumber();
  const request = await dangoteOrderRequestRepo.create({
    requestNumber,
    customerId: req.customer.id,
    companyName: companyName || "",
    licenseId: licenseId ? Number(licenseId) : null,
    product,
    quantity: Number(quantity),
    quantityUnit: quantityUnit || "Tons",
    deliveryAddress,
    deliveryState: deliveryState || "",
    deliveryLga: deliveryLga || "",
    status: "Pending Review",
  });

  const customer = await customerRepo.findById(req.customer.id);
  if (customer?.email) {
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
      console.error("Failed to send Dangote request email:", emailErr.message);
    }
  }

  const full = await dangoteOrderRequestRepo.findByIdFull(request.id);
  res.status(201).json({
    success: true,
    message: "Dangote delivery quote request submitted",
    data: { request: full },
  });
});

/** GET /api/customer/dangote-orders — the customer's own requests, newest first. */
const listMyDangoteOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, status, search } = req.query;
  const result = await dangoteOrderRequestRepo.findAll({
    customerId: req.customer.id,
    status,
    search,
    page,
    limit,
  });
  res.json({ success: true, data: result });
});

/** GET /api/customer/dangote-orders/:id — one of the customer's own requests. */
const getMyDangoteOrder = asyncHandler(async (req, res) => {
  const request = await dangoteOrderRequestRepo.findByIdFull(Number(req.params.id));
  if (!request || request.customerId !== req.customer.id) {
    return res.status(404).json({ success: false, message: "Order request not found" });
  }
  res.json({ success: true, data: { request } });
});

module.exports = {
  getDangoteCatalog,
  createMyDangoteOrder,
  listMyDangoteOrders,
  getMyDangoteOrder,
};
