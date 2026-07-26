const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const {
  getOrders,
  getOrderById,
  createOrder,
  updateOrder,
  cancelOrder,
  completeOrder,
} = require("../../controllers/administration/order.controller");

router.get("/", verifyAdmin, getOrders);
router.get("/:id", verifyAdmin, getOrderById);
router.post("/", verifyAdmin, createOrder);
router.put("/:id", verifyAdmin, updateOrder);
router.post("/:id/cancel", verifyAdmin, cancelOrder);
router.post("/:id/complete", verifyAdmin, completeOrder);

module.exports = router;
