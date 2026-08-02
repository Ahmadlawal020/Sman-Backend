const asyncHandler = require("express-async-handler");

/**
 * Settlement sweep is disabled — orders must be paid manually via the
 * Payable Orders page ("Pay Now" button), same as Dangote delivery orders.
 */
const runSettlement = asyncHandler(async (req, res) => {
  res.status(410).json({
    success: false,
    message: "Settlement sweep is disabled. Orders must be paid manually from the Payable Orders page.",
  });
});

module.exports = { runSettlement };
