const asyncHandler = require("express-async-handler");
const { trackByRef } = require("../../services/tracking.service");

/**
 * GET /api/tracking/:ref — public, sanitised order tracking. See
 * services/tracking.service for what is (and isn't) exposed.
 */
const getTracking = asyncHandler(async (req, res) => {
  const tracked = await trackByRef(req.params.ref);
  if (!tracked) {
    return res.status(404).json({ success: false, message: "No order found for that reference." });
  }
  res.json({ success: true, data: { tracked } });
});

module.exports = { getTracking };
