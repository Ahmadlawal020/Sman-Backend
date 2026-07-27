const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const {
  idParamSchema,
  createOfflineSaleSchema,
  offlinePaymentSchema,
  reviewOfflineSaleSchema,
  offlineSaleQuerySchema,
} = require("../../schemas/offlineSale.schema");
const {
  getOfflineSales,
  getOfflineSaleById,
  createOfflineSale,
  recordOfflinePayment,
  reviewOfflineSale,
  reconcileOfflineSale,
} = require("../../controllers/administration/offlineSale.controller");

router.get("/", verifyStaff, validate({ query: offlineSaleQuerySchema }), getOfflineSales);
router.get("/:id", verifyStaff, validate({ params: idParamSchema }), getOfflineSaleById);
router.post("/", verifyStaff, validate({ body: createOfflineSaleSchema }), createOfflineSale);
router.post(
  "/:id/payments",
  verifyStaff,
  validate({ params: idParamSchema, body: offlinePaymentSchema }),
  recordOfflinePayment
);
router.post(
  "/:id/review",
  verifyStaff,
  validate({ params: idParamSchema, body: reviewOfflineSaleSchema }),
  reviewOfflineSale
);
router.post(
  "/:id/reconcile",
  verifyStaff,
  validate({ params: idParamSchema }),
  reconcileOfflineSale
);

module.exports = router;
