const asyncHandler = require("express-async-handler");
const { publicCatalog } = require("../../services/catalog.service");

/**
 * GET /api/catalog — the orderable depots with priced products, public.
 *
 * Public on purpose: the marketing site shows live prices to visitors who have
 * no account yet, and WhatsApp already quotes the same prices to anyone who
 * messages in. What stays private is quantities — publicCatalog strips stock
 * litres before anything leaves the process.
 */
const getCatalog = asyncHandler(async (req, res) => {
  const depots = await publicCatalog();
  res.json({ success: true, data: { depots } });
});

module.exports = { getCatalog };
