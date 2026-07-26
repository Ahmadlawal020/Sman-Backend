const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const {
  getOrders,
  getOrderById,
  createOrder,
  updateOrder,
  cancelOrder,
  completeOrder,
} = require("../../controllers/administration/order.controller");

router.get("/", verifyStaff, getOrders);
router.get("/:id", verifyStaff, getOrderById);
router.post("/", verifyStaff, createOrder);
router.put("/:id", verifyStaff, updateOrder);
router.post("/:id/cancel", verifyStaff, cancelOrder);
router.post("/:id/complete", verifyStaff, completeOrder);

module.exports = router;
