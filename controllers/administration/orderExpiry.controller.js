const asyncHandler = require("express-async-handler");
const { expireStaleOrders } = require("../../services/order.service");
const { expireStaleRequests } = require("../../services/requestExpiry.service");

/**
 * Expire every stale order and request:
 * - Depot orders: Pending + unpaid older than ORDER_EXPIRY_HOURS
 * - Dangote requests: Approved + unpaid older than ORDER_EXPIRY_HOURS since review
 * - LPG requests: Approved + unpaid older than ORDER_EXPIRY_HOURS since review
 *
 * Idempotent and safe behind a cron.
 */
const runExpiry = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const expired = await expireStaleOrders();
  const requests = await expireStaleRequests();

  const totalExpired = expired + requests.dangote + requests.lpg;

  console.log(
    `[expiry] manual run by staff ${req.user.id} expired ${expired} depot order(s), ` +
    `${requests.dangote} Dangote request(s), ${requests.lpg} LPG request(s) in ${Date.now() - startedAt}ms`
  );

  res.json({
    success: true,
    message: `Expired ${totalExpired} order(s)/request(s) (${expired} depot, ${requests.dangote} Dangote, ${requests.lpg} LPG)`,
    data: { depotOrders: expired, dangoteRequests: requests.dangote, lpgRequests: requests.lpg, durationMs: Date.now() - startedAt },
  });
});

module.exports = { runExpiry };
