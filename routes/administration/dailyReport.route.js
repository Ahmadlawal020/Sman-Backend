const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const {
  idParamSchema,
  submitDailyReportSchema,
  amendDailyReportSchema,
  reviewDailyReportSchema,
  dailyReportQuerySchema,
} = require("../../schemas/dailyReport.schema");
const {
  getDailyReports,
  getDailyReportById,
  submitDailyReport,
  deleteDailyReport,
  amendDailyReport,
  reviewDailyReport,
} = require("../../controllers/administration/dailyReport.controller");

router.get("/", verifyStaff, validate({ query: dailyReportQuerySchema }), getDailyReports);
router.get("/:id", verifyStaff, validate({ params: idParamSchema }), getDailyReportById);
router.delete("/:id", verifyStaff, deleteDailyReport);
router.post("/", verifyStaff, validate({ body: submitDailyReportSchema }), submitDailyReport);
router.patch(
  "/:id",
  verifyStaff,
  validate({ params: idParamSchema, body: amendDailyReportSchema }),
  amendDailyReport
);
router.post(
  "/:id/review",
  verifyStaff,
  validate({ params: idParamSchema, body: reviewDailyReportSchema }),
  reviewDailyReport
);

module.exports = router;
