const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const commissionSchemas = require("../../schemas/commission.schema");
const {
  getCommissions,
  getCommissionById,
  confirmPayment,
  getSummary,
  getRates,
  upsertRate,
  generateDailyReport,
} = require("../../controllers/administration/commission.controller");

router.get("/", verifyStaff, validate({ query: commissionSchemas.listCommissions }), getCommissions);
router.get("/summary", verifyStaff, getSummary);
router.get("/rates", verifyStaff, getRates);
router.get("/:id", verifyStaff, validate({ params: commissionSchemas.idParam }), getCommissionById);
router.patch("/:id/confirm-payment", verifyStaff, validate({ params: commissionSchemas.idParam }), confirmPayment);
router.post("/rates", verifyStaff, validate({ body: commissionSchemas.upsertRate }), upsertRate);
router.post("/daily-report", verifyStaff, validate({ body: commissionSchemas.dailyReport }), generateDailyReport);

module.exports = router;
