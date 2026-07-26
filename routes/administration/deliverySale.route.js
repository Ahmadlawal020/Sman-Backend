const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const {
  getDeliverySales,
  getDeliverySaleById,
  createDeliverySale,
  updateDeliverySale,
  deleteDeliverySale,
} = require("../../controllers/administration/deliverySale.controller");

router.get("/", verifyStaff, getDeliverySales);
router.get("/:id", verifyStaff, getDeliverySaleById);
router.post("/", verifyStaff, createDeliverySale);
router.patch("/:id", verifyStaff, updateDeliverySale);
router.delete("/:id", verifyStaff, deleteDeliverySale);

module.exports = router;
