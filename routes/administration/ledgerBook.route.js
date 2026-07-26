const express = require("express");
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const {
  idParamSchema,
  postLedgerEntrySchema,
  statementQuerySchema,
} = require("../../schemas/ledger.schema");
const { deliveryLedger, stationLedger } = require("../../controllers/administration/ledgerBook.controller");

// Mounted twice from app.js: /api/delivery-ledger and /api/station-ledger.
const makeBookRouter = (controller) => {
  const router = express.Router();
  router.get(
    "/:id/statement",
    verifyStaff,
    validate({ params: idParamSchema, query: statementQuerySchema }),
    controller.getStatement
  );
  router.get("/:id/balance", verifyStaff, validate({ params: idParamSchema }), controller.getBalance);
  router.post(
    "/:id/entries",
    verifyStaff,
    validate({ params: idParamSchema, body: postLedgerEntrySchema }),
    controller.postEntry
  );
  return router;
};

module.exports = {
  deliveryLedgerRouter: makeBookRouter(deliveryLedger),
  stationLedgerRouter: makeBookRouter(stationLedger),
};
