const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const {
  createDeliveryCustomer,
  getDeliveryCustomers,
  createDeliveryNote,
  updateDeliveryCustomer,
  deleteDeliveryCustomer,
} = require("../../controllers/customer/deliveryCustomer.controller");

router.get("/", verifyAdmin, getDeliveryCustomers);
router.post("/", verifyAdmin, createDeliveryCustomer);
router.patch("/:id", verifyAdmin, updateDeliveryCustomer);
router.put("/:id", verifyAdmin, updateDeliveryCustomer);
router.delete("/:id", verifyAdmin, deleteDeliveryCustomer);
router.post("/delivery-notes", verifyAdmin, createDeliveryNote);

module.exports = router;
