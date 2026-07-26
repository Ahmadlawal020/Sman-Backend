const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const {
  getDeliverySales,
  getDeliverySaleById,
  createDeliverySale,
  updateDeliverySale,
  deleteDeliverySale,
} = require("../../controllers/administration/deliverySale.controller");

router.get("/", verifyAdmin, getDeliverySales);
router.get("/:id", verifyAdmin, getDeliverySaleById);
router.post("/", verifyAdmin, createDeliverySale);
router.patch("/:id", verifyAdmin, updateDeliverySale);
router.delete("/:id", verifyAdmin, deleteDeliverySale);

module.exports = router;
