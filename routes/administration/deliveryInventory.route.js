const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
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

router.get("/", verifyStaff, getDeliveryInventory);
router.get("/:id", verifyStaff, getDeliveryInventoryById);
router.post("/", verifyStaff, createDeliveryInventory);
router.patch("/:id", verifyStaff, updateDeliveryInventory);
router.delete("/:id", verifyStaff, deleteDeliveryInventory);

// Release workflow: pending -> confirmed -> released, one-way. Releasing
// posts the sale to the customer's delivery ledger.
router.post("/:id/confirm", verifyStaff, confirmAllocation);
router.post("/:id/release", verifyStaff, releaseAllocation);
router.post("/:id/reject", verifyStaff, rejectAllocation);

module.exports = router;
