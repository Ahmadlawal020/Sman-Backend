const asyncHandler = require("express-async-handler");
const { offlineSaleRepo } = require("../../repositories");
const offlineSaleService = require("../../services/offlineSale.service");
const { sendServiceResult } = require("../../utils/serviceResult");
const { staffActor } = require("../../utils/actor");

const getOfflineSales = asyncHandler(async (req, res) => {
  const result = await offlineSaleRepo.findAll(req.query);
  res.json({ success: true, data: result });
});

const getOfflineSaleById = asyncHandler(async (req, res) => {
  const sale = await offlineSaleRepo.findByIdWithItems(req.params.id);
  if (!sale) {
    return res.status(404).json({ success: false, message: "Offline sale not found" });
  }
  res.json({ success: true, data: { sale } });
});

const createOfflineSale = asyncHandler(async (req, res) => {
  const result = await offlineSaleService.createSale(req.body, { actor: staffActor(req) });
  sendServiceResult(res, result, { successStatus: 201, message: "Offline sale recorded" });
});

const recordOfflinePayment = asyncHandler(async (req, res) => {
  const result = await offlineSaleService.recordPayment(req.params.id, req.body, {
    actor: staffActor(req),
  });
  sendServiceResult(res, result, { message: "Payment recorded" });
});

const reviewOfflineSale = asyncHandler(async (req, res) => {
  const result = await offlineSaleService.reviewSale(req.params.id, req.body, {
    actor: staffActor(req),
  });
  sendServiceResult(res, result, {
    message: req.body.approve ? "Sale approved" : "Sale rejected",
  });
});

const reconcileOfflineSale = asyncHandler(async (req, res) => {
  const result = await offlineSaleService.reconcileSale(req.params.id, { actor: staffActor(req) });
  sendServiceResult(res, result, { message: "Sale reconciled" });
});

module.exports = {
  getOfflineSales,
  getOfflineSaleById,
  createOfflineSale,
  recordOfflinePayment,
  reviewOfflineSale,
  reconcileOfflineSale,
};
