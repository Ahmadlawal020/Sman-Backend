const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const { requireRole } = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const depotSchemas = require("../../schemas/depot.schema");
const {
  getDepots,
  getDepotById,
  createDepot,
  updateDepot,
  deleteDepot,
  updateProductPrice,
} = require("../../controllers/administration/depot.controller");

router.get("/", verifyStaff, validate({ query: depotSchemas.listDepots }), getDepots);
router.get("/:id", verifyStaff, validate({ params: depotSchemas.idParam }), getDepotById);
router.post("/", verifyStaff, validate({ body: depotSchemas.createDepot }), createDepot);
router.patch("/:id", verifyStaff, validate({ params: depotSchemas.idParam, body: depotSchemas.updateDepot }), updateDepot);
// Repricing fuel is a money operation. It previously carried no role gate at
// all, so any account holding the generic `admin` role could change the price
// at any depot.
router.patch(
  "/:id/product-price",
  verifyStaff,
  requireRole("super_admin", "finance", { message: "Finance access required" }),
  validate({ params: depotSchemas.idParam, body: depotSchemas.updateProductPrice }),
  updateProductPrice
);
router.delete("/:id", verifyStaff, validate({ params: depotSchemas.idParam }), deleteDepot);

module.exports = router;
