const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const {
  getDeliveryInventory,
  getDeliveryInventoryById,
  createDeliveryInventory,
  updateDeliveryInventory,
  deleteDeliveryInventory,
} = require("../../controllers/administration/deliveryInventory.controller");

router.get("/", verifyAdmin, getDeliveryInventory);
router.get("/:id", verifyAdmin, getDeliveryInventoryById);
router.post("/", verifyAdmin, createDeliveryInventory);
router.patch("/:id", verifyAdmin, updateDeliveryInventory);
router.delete("/:id", verifyAdmin, deleteDeliveryInventory);

module.exports = router;
