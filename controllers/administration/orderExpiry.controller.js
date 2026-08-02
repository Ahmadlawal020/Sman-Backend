const asyncHandler = require("express-async-handler");
const { expireStaleOrders } = require("../../services/order.service");

/**
 * Expire every Pending, unpaid order older than ORDER_EXPIRY_HOURS, returning
 * its reserved stock and depot capacity.
 *
 * Idempotent and safe behind a cron: an order already Paid, Cancelled or
 * Expired is not Pending, so a second run in a row expires nothing new.
 */
const runExpiry = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const expired = await expireStaleOrders();

  console.log(
    `[expiry] manual run by staff ${req.user.id} expired ${expired} order(s) in ${Date.now() - startedAt}ms`
  );

  res.json({
    success: true,
    message: `Expired ${expired} order(s)`,
    data: { expired, durationMs: Date.now() - startedAt },
  });
});

module.exports = { runExpiry };
