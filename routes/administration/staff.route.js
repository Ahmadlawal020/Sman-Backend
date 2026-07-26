const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const {
  createAdmin,
  getAllAdmins,
  getAdminById,
  updateAdmin,
  deleteAdmin,
  resendInvite,
} = require("../../controllers/administration/staff.controller");
const { requireRole } = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const misc = require("../../schemas/misc.schema");

router.use(verifyStaff);

router.post("/", requireRole("super_admin"), validate({ body: misc.createStaff }), createAdmin);
router.get("/", validate({ query: misc.listStaff }), getAllAdmins);
router.get("/:id", validate({ params: misc.idParam }), getAdminById);
router.patch("/:id", validate({ params: misc.idParam, body: misc.updateStaff }), updateAdmin);
router.delete("/:id", requireRole("super_admin"), validate({ params: misc.idParam }), deleteAdmin);
router.post("/:id/resend-invite", validate({ params: misc.idParam }), resendInvite);

module.exports = router;
