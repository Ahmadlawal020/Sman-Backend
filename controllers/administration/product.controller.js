const asyncHandler = require("express-async-handler");
const { productRepo, orderRepo, pfiRepo } = require("../../repositories");
const { db } = require("../../config/db");
const { consumerPfi: pfis, consumerOrderproduct, depotProductCapacities } = require("../../db/schema");
const { eq, count } = require("drizzle-orm");

const getProducts = asyncHandler(async (req, res) => {
  const { search, productType, page = 1, limit = 50 } = req.query;

  const result = await productRepo.findAll({ search, productType, page, limit });

  res.json({ success: true, data: result });
});

const getProductById = asyncHandler(async (req, res) => {
  const product = await productRepo.findById(req.params.id);

  if (!product) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  res.json({ success: true, data: { product } });
});

const createProduct = asyncHandler(async (req, res) => {
  const { name, sku, category, productType, gradeClass, description, density, flashPoint, unNumber, hazardClass, stockLevel, unit, supplier } = req.body;

  if (!name || !sku || !category) {
    return res.status(400).json({
      success: false,
      message: "Name, SKU, and category are required",
    });
  }

  const existing = await productRepo.findBySku(sku);
  if (existing) {
    return res.status(409).json({
      success: false,
      message: "A product with this SKU already exists",
    });
  }

  const product = await productRepo.create({
    name,
    sku,
    category,
    productType: productType || "soroman",
    gradeClass: gradeClass || "",
    description: description || "",
    density: density || "",
    flashPoint: flashPoint || "",
    unNumber: unNumber || "",
    hazardClass: hazardClass || "None",
    stockLevel: stockLevel ?? 0,
    unit: unit || "Liters",
    supplier: supplier || "",
  });

  res.status(201).json({
    success: true,
    message: "Product created successfully",
    data: { product },
  });
});

const updateProduct = asyncHandler(async (req, res) => {
  const product = await productRepo.findById(req.params.id);

  if (!product) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  const allowedFields = [
    "name", "sku", "category", "productType", "gradeClass", "description", "density",
    "flashPoint", "unNumber", "hazardClass", "stockLevel", "unit", "supplier",
  ];

  const updateData = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  const updated = await productRepo.update(product.id, updateData);

  res.json({
    success: true,
    message: "Product updated successfully",
    data: { product: updated },
  });
});

const deleteProduct = asyncHandler(async (req, res) => {
  const product = await productRepo.findById(req.params.id);

  if (!product) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  // Order line items live in consumer_orderproduct now, not inline on
  // consumer_order (see order.repository.js's header comment).
  const [{ orderCount }] = await db.select({ orderCount: count() }).from(consumerOrderproduct).where(eq(consumerOrderproduct.productId, product.id));
  const [{ pfiCount }] = await db.select({ pfiCount: count() }).from(pfis).where(eq(pfis.productId, product.id));
  const [{ depotCount }] = await db.select({ depotCount: count() }).from(depotProductCapacities).where(eq(depotProductCapacities.productId, product.id));

  const references = [];
  if (orderCount > 0) references.push(`${orderCount} order(s)`);
  if (pfiCount > 0) references.push(`${pfiCount} PFI(s)`);
  if (depotCount > 0) references.push(`${depotCount} depot(s)`);

  if (references.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Cannot delete product: it is referenced by ${references.join(", ")}`,
    });
  }

  await productRepo.deleteById(product.id);

  res.json({ success: true, message: "Product deleted successfully" });
});

module.exports = { getProducts, getProductById, createProduct, updateProduct, deleteProduct };
