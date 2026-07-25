const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} = require("../../controllers/administration/customer.controller");

router.get("/", verifyAdmin, getCustomers);
router.get("/:id", verifyAdmin, getCustomerById);
router.post("/", verifyAdmin, createCustomer);
router.patch("/:id", verifyAdmin, updateCustomer);
router.delete("/:id", verifyAdmin, deleteCustomer);

module.exports = router;
