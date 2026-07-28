const asyncHandler = require("express-async-handler");
const { getDashboard } = require("../../services/dashboard.service");

/**
 * GET /api/customer/dashboard — everything the portal home screen shows for
 * the signed-in customer: wallet balance, this month's totals, a daily spend
 * series, and the most recent orders. See services/dashboard.service.
 */
const getMyDashboard = asyncHandler(async (req, res) => {
  const data = await getDashboard(req.customer);
  res.json({ success: true, data });
});

module.exports = { getMyDashboard };
