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

router.use(verifyStaff);

router.post("/", requireRole("super_admin"), createAdmin);
router.get("/", getAllAdmins);
router.get("/:id", getAdminById);
router.patch("/:id", updateAdmin);
router.delete("/:id", requireRole("super_admin"), deleteAdmin);
router.post("/:id/resend-invite", resendInvite);

module.exports = router;
