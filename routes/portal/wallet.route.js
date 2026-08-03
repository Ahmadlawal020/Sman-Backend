const express = require("express");
const router = express.Router();
const { authenticateCustomer } = require("../../middleware/verifyCustomer");
const validate = require("../../middleware/validate");
const walletSchemas = require("../../schemas/wallet.schema");
const { getMyWalletTransactions } = require("../../controllers/portal/wallet.controller");

// Read-only history of the caller's own wallet. No requireActiveCustomer: a
// Pending customer has an (empty) ledger and may still open the screen.
router.get(
  "/transactions",
  authenticateCustomer,
  validate({ query: walletSchemas.listTransactions }),
  getMyWalletTransactions
);

module.exports = router;
