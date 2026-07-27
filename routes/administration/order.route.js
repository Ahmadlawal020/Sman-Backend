const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const orderSchemas = require("../../schemas/order.schema");
const {
  getOrders,
  getOrderById,
  createOrder,
  updateOrder,
  cancelOrder,
  completeOrder,
} = require("../../controllers/administration/order.controller");

router.get("/", verifyStaff, validate({ query: orderSchemas.listOrders }), getOrders);
router.get("/:id", verifyStaff, validate({ params: orderSchemas.idParam }), getOrderById);
router.post("/", verifyStaff, validate({ body: orderSchemas.createOrder }), createOrder);
router.put("/:id", verifyStaff, updateOrder);
router.post("/:id/cancel", verifyStaff, validate({ params: orderSchemas.idParam }), cancelOrder);
router.post("/:id/complete", verifyStaff, validate({ params: orderSchemas.idParam }), completeOrder);

module.exports = router;
