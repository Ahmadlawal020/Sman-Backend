const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} = require("../../controllers/administration/customer.controller");

router.get("/", verifyStaff, getCustomers);
router.get("/:id", verifyStaff, getCustomerById);
router.post("/", verifyStaff, createCustomer);
router.patch("/:id", verifyStaff, updateCustomer);
router.delete("/:id", verifyStaff, deleteCustomer);

module.exports = router;
