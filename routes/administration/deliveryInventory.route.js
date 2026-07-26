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

router.get("/", verifyStaff, getDeliveryInventory);
router.get("/:id", verifyStaff, getDeliveryInventoryById);
router.post("/", verifyStaff, createDeliveryInventory);
router.patch("/:id", verifyStaff, updateDeliveryInventory);
router.delete("/:id", verifyStaff, deleteDeliveryInventory);

module.exports = router;
