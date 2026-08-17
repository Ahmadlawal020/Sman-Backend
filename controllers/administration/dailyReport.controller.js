const asyncHandler = require("express-async-handler");
const { dailyReportRepo } = require("../../repositories");
const dailyReportService = require("../../services/dailyReport.service");
const { sendServiceResult } = require("../../utils/serviceResult");
const { staffActor } = require("../../utils/actor");

// Roles that manage reports rather than file them — the Reports Hub's own
// allowed-roles list (see rbac.ts '/admin-reports'). Everyone else only ever
// sees their own submissions, no matter what the query string asks for:
// trusting a client-supplied submittedBy here would let any reporting role
// read any other filer's numbers by hand-editing the request.
const CAN_VIEW_ALL_REPORTS = new Set(["admin", "super_admin", "audit"]);

const getDailyReports = asyncHandler(async (req, res) => {
  const roles = new Set(req.user?.roles || []);
  const canViewAll = [...roles].some((r) => CAN_VIEW_ALL_REPORTS.has(r));
  const result = await dailyReportRepo.findAll({
    ...req.query,
    submittedBy: canViewAll ? req.query.submittedBy : req.user?.id,
  });
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

/**
 * Remove a report. Only the person who filed it, or an admin.
 *
 * Role gating upstream was client-side only — localStorage decided which panel
 * rendered and the API enforced nothing, so any signed-in user could file or
 * remove any report type by hand.
 */
const deleteDailyReport = asyncHandler(async (req, res) => {
  const existing = await dailyReportRepo.findById(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: "Report not found" });

  const roles = new Set(req.user?.roles || []);
  const mine = Number(existing.submittedBy) === Number(req.user?.id);
  if (!mine && !roles.has("admin") && !roles.has("super_admin")) {
    return res.status(403).json({ success: false, message: "You can only delete your own reports" });
  }

  await dailyReportRepo.remove(existing.id);
  res.json({ success: true, message: "Report deleted" });
});

module.exports = {
  deleteDailyReport,
  getDailyReports,
  getDailyReportById,
  submitDailyReport,
  amendDailyReport,
  reviewDailyReport,
};
