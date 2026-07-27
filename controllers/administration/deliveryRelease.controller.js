const asyncHandler = require("express-async-handler");
const deliveryService = require("../../services/delivery.service");
const { sendServiceResult } = require("../../utils/serviceResult");
const { staffActor } = require("../../utils/actor");

// Release workflow endpoints for delivery allocations. Kept apart from the
// CRUD controller: these are state transitions with financial consequences,
// not field edits.

const confirmAllocation = asyncHandler(async (req, res) => {
  const result = await deliveryService.confirmAllocation(req.params.id, {
    actor: staffActor(req),
  });
  sendServiceResult(res, result, { message: "Allocation confirmed" });
});

const releaseAllocation = asyncHandler(async (req, res) => {
  const result = await deliveryService.releaseAllocation(req.params.id, {
    actor: staffActor(req),
  });
  sendServiceResult(res, result, { message: "Allocation released" });
});

const rejectAllocation = asyncHandler(async (req, res) => {
  const result = await deliveryService.rejectAllocation(req.params.id, {
    actor: staffActor(req),
    reason: req.body.reason || "",
  });
  sendServiceResult(res, result, { message: "Allocation rejected back to pending" });
});

module.exports = { confirmAllocation, releaseAllocation, rejectAllocation };
