const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const saleSchemas = require("../../schemas/deliverySale.schema");
const {
  getDeliverySales,
  getDeliverySaleById,
  createDeliverySale,
  updateDeliverySale,
  deleteDeliverySale,
} = require("../../controllers/administration/deliverySale.controller");

router.get("/", verifyStaff, validate({ query: saleSchemas.listDeliverySales }), getDeliverySales);
router.get("/:id", verifyStaff, validate({ params: saleSchemas.idParam }), getDeliverySaleById);
router.post("/", verifyStaff, validate({ body: saleSchemas.createDeliverySale }), createDeliverySale);
router.patch("/:id", verifyStaff, validate({ params: saleSchemas.idParam, body: saleSchemas.updateDeliverySale }), updateDeliverySale);
router.delete("/:id", verifyStaff, validate({ params: saleSchemas.idParam }), deleteDeliverySale);

module.exports = router;
