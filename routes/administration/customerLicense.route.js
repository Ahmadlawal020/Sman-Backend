const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const { authenticateStaff, requireRole } = verifyStaff;
const validate = require("../../middleware/validate");
const schemas = require("../../schemas/customerLicense.schema");
const {
  list,
  getById,
  verifyLicense,
  rejectLicense,
  download,
} = require("../../controllers/administration/customerLicense.controller");

// Staff license registry: /api/customer-licenses. Verify/reject carry the
// same role gate as order review.
const reviewer = [
  authenticateStaff,
  requireRole("orders", "super_admin", { message: "Order review access required" }),
];

router.get("/", verifyStaff, validate({ query: schemas.staffList }), list);
router.get("/:id", verifyStaff, getById);
router.get("/:id/download", verifyStaff, download);
router.post("/:id/verify", ...reviewer, validate({ body: schemas.verifyLicense }), verifyLicense);
router.post("/:id/reject", ...reviewer, validate({ body: schemas.rejectLicense }), rejectLicense);

module.exports = router;
