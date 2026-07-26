const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const {
  createDeliveryCustomer,
  getDeliveryCustomers,
  createDeliveryNote,
  updateDeliveryCustomer,
  deleteDeliveryCustomer,
} = require("../../controllers/customer/deliveryCustomer.controller");

router.get("/", verifyStaff, getDeliveryCustomers);
router.post("/", verifyStaff, createDeliveryCustomer);
router.patch("/:id", verifyStaff, updateDeliveryCustomer);
router.put("/:id", verifyStaff, updateDeliveryCustomer);
router.delete("/:id", verifyStaff, deleteDeliveryCustomer);
router.post("/delivery-notes", verifyStaff, createDeliveryNote);

module.exports = router;
