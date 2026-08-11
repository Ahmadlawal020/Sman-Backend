const asyncHandler = require("express-async-handler");
const { publicCatalog } = require("../../services/catalog.service");
const { orderExpiryHours } = require("../../config/orderExpiry");

/**
 * GET /api/catalog — the orderable depots with priced products, public.
 *
 * Public on purpose: the marketing site shows live prices to visitors who have
 * no account yet, and WhatsApp already quotes the same prices to anyone who
 * messages in. What stays private is quantities — publicCatalog strips stock
 * litres before anything leaves the process.
 *
 * Also returns `orderExpiryHours` (from ORDER_EXPIRY_HOURS) so the portal can
 * promise the same payment window the sweep enforces, without hardcoding it.
 */
const getCatalog = asyncHandler(async (req, res) => {
  const depots = await publicCatalog();
  res.json({
    success: true,
    data: { depots, orderExpiryHours: orderExpiryHours() },
  });
});

module.exports = { getCatalog };
