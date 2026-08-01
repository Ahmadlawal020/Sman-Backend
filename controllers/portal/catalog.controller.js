const asyncHandler = require("express-async-handler");
const { publicCatalog } = require("../../services/catalog.service");
const { productRepo } = require("../../repositories");

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

/**
 * GET /api/catalog/dangote-products — the active Dangote delivery products
 * (PMS/AGO/LPG), public. The wizard loads its product tiles from here so the
 * catalog is the source of truth for what's orderable; the frontend keeps its
 * own display strings keyed by code.
 */
const getDangoteProducts = asyncHandler(async (req, res) => {
  const rows = await productRepo.findActiveDangote();
  const products = rows.map((p) => ({
    id: p.id,
    code: p.category, // trade code (PMS/AGO/LPG), by app convention
    name: p.name,
    unit: p.unit, // straight from the catalog column — the source of truth
  }));
  res.json({ success: true, data: { products } });
});

module.exports = { getCatalog, getDangoteProducts };
