const asyncHandler = require("express-async-handler");
const { processAllUnpaidOrders } = require("../../services/payment.service");

/**
 * Apply available wallet balances to unpaid orders.
 *
 * Idempotent: it settles only what the balance covers, and each debit is
 * guarded, so running it twice in a row settles nothing the second time.
 * That property is what makes it safe to put behind a cron.
 */
const runSettlement = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const settled = await processAllUnpaidOrders();

  console.log(
    `[settlement] manual run by staff ${req.user.id} settled ${settled} order(s) in ${Date.now() - startedAt}ms`
  );

  res.json({
    success: true,
    message: `Settled ${settled} order(s)`,
    data: { settled, durationMs: Date.now() - startedAt },
  });
});

module.exports = { runSettlement };
