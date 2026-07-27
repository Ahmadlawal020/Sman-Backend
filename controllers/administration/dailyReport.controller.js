const asyncHandler = require("express-async-handler");
const { dailyReportRepo } = require("../../repositories");
const dailyReportService = require("../../services/dailyReport.service");
const { sendServiceResult } = require("../../utils/serviceResult");
const { staffActor } = require("../../utils/actor");

const getDailyReports = asyncHandler(async (req, res) => {
  const result = await dailyReportRepo.findAll(req.query);
  res.json({ success: true, data: result });
});

const getDailyReportById = asyncHandler(async (req, res) => {
  const report = await dailyReportRepo.findById(req.params.id);
  if (!report) {
    return res.status(404).json({ success: false, message: "Report not found" });
  }
  res.json({ success: true, data: { report } });
});

const submitDailyReport = asyncHandler(async (req, res) => {
  const result = await dailyReportService.submitReport(req.body, { actor: staffActor(req) });
  sendServiceResult(res, result, { successStatus: 201, message: "Report submitted" });
});

const amendDailyReport = asyncHandler(async (req, res) => {
  const result = await dailyReportService.amendReport(req.params.id, req.body, {
    actor: staffActor(req),
  });
  sendServiceResult(res, result, { message: "Report amended" });
});

const reviewDailyReport = asyncHandler(async (req, res) => {
  const result = await dailyReportService.reviewReport(req.params.id, req.body, {
    actor: staffActor(req),
  });
  sendServiceResult(res, result, {
    message: req.body.approve ? "Report approved" : "Report rejected",
  });
});

module.exports = {
  getDailyReports,
  getDailyReportById,
  submitDailyReport,
  amendDailyReport,
  reviewDailyReport,
};
