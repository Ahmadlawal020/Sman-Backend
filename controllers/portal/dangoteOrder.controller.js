const asyncHandler = require("express-async-handler");
const {
  dangoteProductRepo,
  dangoteOrderRequestRepo,
  customerRepo,
  customerLicenseRepo,
} = require("../../repositories");
const { sendDangoteRequestReceivedEmail } = require("../../services/email.service");
const { notify } = require("../../notifications");
const walletService = require("../../services/wallet.service");
const { withRequestExpiresAt, expireIfStale } = require("../../services/requestExpiry.service");

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

  // Acknowledgement in the app, plus the desk's heads-up. The email above is
  // unchanged — the catalog entry is APP_ONLY so nothing is sent twice.
  notify("dangote.request_received", {
    to: { customerId: req.customer.id },
    data: {
      requestId: request.id,
      requestNumber,
      customerName: customer?.name,
      product,
      quantity: Number(quantity),
      quantityUnit: quantityUnit || "Tons",
    },
  });
  notify("staff.request_submitted", {
    to: { roles: ["admin", "super_admin", "sales_manager"] },
    data: {
      requestId: request.id,
      requestNumber,
      kind: "Dangote",
      customerName: customer?.name,
      entityType: "dangote_request",
      screen: "DangoteOrderDetail",
      adminPath: `/dangote-orders/${request.id}`,
    },
  });

  const full = await dangoteOrderRequestRepo.findByIdFull(request.id);
  res.status(201).json({
    success: true,
    message: "Dangote delivery quote request submitted",
    data: { request: full },
  });
});

/** GET /api/customer/dangote-orders — the customer's own requests, newest first. */
const listMyDangoteOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, status, paymentStatus, search } = req.query;
  const result = await dangoteOrderRequestRepo.findAll({
    customerId: req.customer.id,
    status,
    paymentStatus,
    search,
    page,
    limit,
  });
  const requests = await withRequestExpiresAt(
    result.requests.map((r) => ({ ...r, _type: "dangote" }))
  );
  res.json({ success: true, data: { ...result, requests } });
});

/** GET /api/customer/dangote-orders/:id — one of the customer's own requests. */
const getMyDangoteOrder = asyncHandler(async (req, res) => {
  const request = await dangoteOrderRequestRepo.findByIdFull(Number(req.params.id));
  if (!request || request.customerId !== req.customer.id) {
    return res.status(404).json({ success: false, message: "Order request not found" });
  }
  const enriched = await withRequestExpiresAt({ ...request, _type: "dangote" });
  res.json({ success: true, data: { request: enriched } });
});

/**
 * POST /api/customer/dangote-orders/:id/pay — the signed-in customer settles
 * their OWN approved quote from wallet balance. Customer twin of the staff
 * finance pay route: same guards (must be Approved + Unpaid) and the same
 * wallet debit, but scoped to req.customer — a foreign request is a 404, and
 * the already-Paid / not-yet-Approved guards double as the double-pay guard.
 */
const payMyDangoteOrder = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  // Pre-payment guard: if the request has lapsed, expire it and refuse.
  const wasExpired = await expireIfStale({ requestId: id, type: "dangote", customerId: req.customer.id });
  if (wasExpired) {
    return res.status(409).json({
      success: false,
      message: "This order has expired because payment wasn't received in time. Please submit a new request at current prices.",
    });
  }

  const existing = await dangoteOrderRequestRepo.findById(id);
  if (!existing || existing.customerId !== req.customer.id) {
    return res.status(404).json({ success: false, message: "Order request not found" });
  }
  if (existing.paymentStatus === "Paid") {
    return res.status(409).json({ success: false, message: "Order is already paid" });
  }
  if (existing.status === "Expired") {
    return res.status(409).json({ success: false, message: "This order has expired. Please submit a new request at current prices." });
  }
  if (existing.status !== "Approved") {
    return res.status(409).json({ success: false, message: `Cannot pay an order in ${existing.status} status` });
  }

  const totalAmount = Number(existing.totalAmount);
  if (!totalAmount || totalAmount <= 0) {
    return res.status(400).json({ success: false, message: "Order total is invalid" });
  }

  const debitResult = await walletService.debit({
    customerId: req.customer.id,
    amount: totalAmount,
    description: `Payment for Dangote Order ${existing.requestNumber}`,
    reference: `DNG-PAY-${existing.id}`,
  });

  if (!debitResult.success) {
    if (debitResult.insufficient) {
      const customer = await customerRepo.findById(req.customer.id);
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Required: ₦${totalAmount.toLocaleString()}, Available: ₦${Number(customer?.balance || 0).toLocaleString()}`,
      });
    }
    return res.status(400).json({ success: false, message: debitResult.message || "Payment failed" });
  }

  await dangoteOrderRequestRepo.update(id, {
    paymentStatus: "Paid",
    paymentMode: "wallet",
    paymentReference: debitResult.deposit?.reference || `DNG-PAY-${existing.id}`,
  });

  const request = await dangoteOrderRequestRepo.findByIdFull(id);
  res.json({
    success: true,
    message: `Dangote order ${existing.requestNumber} paid from your wallet balance.`,
    data: { request },
  });
});

/**
 * POST /api/customer/dangote-orders/:id/cancel — the customer withdraws their
 * OWN quote request while it is still unpaid. Pending Review and Approved +
 * Unpaid both cancel; Paid or already-terminal requests cannot. Lands as
 * Cancelled (distinct from staff Rejected).
 */
const cancelMyDangoteOrder = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  const existing = await dangoteOrderRequestRepo.findById(id);
  if (!existing || existing.customerId !== req.customer.id) {
    return res.status(404).json({ success: false, message: "Order request not found" });
  }

  if (existing.status === "Cancelled" || existing.status === "Rejected") {
    return res.status(409).json({
      success: false,
      message: `This request is already ${existing.status.toLowerCase()}.`,
    });
  }

  if (existing.paymentStatus === "Paid") {
    return res.status(409).json({
      success: false,
      message: "A paid quote can't be cancelled here — contact support.",
    });
  }

  // Only withdraw before payment: under review, or approved but still unpaid.
  if (existing.status !== "Pending Review" && existing.status !== "Approved") {
    return res.status(409).json({
      success: false,
      message: `Cannot cancel a request in ${existing.status} status.`,
    });
  }

  // The checks above are a friendly fast-path off a stale read; this is the one
  // that actually decides. The conditional UPDATE re-verifies ownership, status
  // and unpaid-ness atomically, so a wallet payment that lands between the read
  // and here loses the race (zero rows) instead of leaving a Paid-but-Cancelled
  // request with the money already debited.
  const cancelled = await dangoteOrderRequestRepo.cancelIfWithdrawable(id, req.customer.id);
  if (!cancelled) {
    return res.status(409).json({
      success: false,
      message: "This request can no longer be cancelled — it may have just been paid. Please refresh.",
    });
  }

  const request = await dangoteOrderRequestRepo.findByIdFull(id);
  res.json({
    success: true,
    message: "Quote request cancelled",
    data: { request },
  });
});

module.exports = {
  getDangoteCatalog,
  createMyDangoteOrder,
  listMyDangoteOrders,
  getMyDangoteOrder,
  payMyDangoteOrder,
  cancelMyDangoteOrder,
};
