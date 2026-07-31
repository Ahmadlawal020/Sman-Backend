const asyncHandler = require("express-async-handler");
const { dangoteProductRepo } = require("../../repositories");

// Legacy Dangote cement product catalog CRUD only. The request/order
// endpoints that used to live here were replaced by the quote desk in
// controllers/administration/dangoteDelivery.controller.js; this whole
// module (and the dangote_products table) is dropped at cleanup once
// nothing depends on it.

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

module.exports = {
  getDangoteProducts,
  getDangoteProductsActive,
  getDangoteProductById,
  createDangoteProduct,
  updateDangoteProduct,
};
