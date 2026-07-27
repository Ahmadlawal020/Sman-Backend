const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const misc = require("../../schemas/misc.schema");
const {
  getDeliveryInventory,
  getDeliveryInventoryById,
  createDeliveryInventory,
  updateDeliveryInventory,
  deleteDeliveryInventory,
} = require("../../controllers/administration/deliveryInventory.controller");
const {
  confirmAllocation,
  releaseAllocation,
  rejectAllocation,
} = require("../../controllers/administration/deliveryRelease.controller");

router.get("/", verifyStaff, validate({ query: misc.listInventory }), getDeliveryInventory);
router.get("/:id", verifyStaff, validate({ params: misc.idParam }), getDeliveryInventoryById);
router.post("/", verifyStaff, validate({ body: misc.createInventory }), createDeliveryInventory);
router.patch("/:id", verifyStaff, validate({ params: misc.idParam, body: misc.updateInventory }), updateDeliveryInventory);
router.delete("/:id", verifyStaff, validate({ params: misc.idParam }), deleteDeliveryInventory);

// Release workflow: pending -> confirmed -> released, one-way. Releasing
// posts the sale to the customer's delivery ledger.
router.post("/:id/confirm", verifyStaff, confirmAllocation);
router.post("/:id/release", verifyStaff, releaseAllocation);
router.post("/:id/reject", verifyStaff, rejectAllocation);

module.exports = router;
