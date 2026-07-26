const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const {
  createAdmin,
  getAllAdmins,
  getAdminById,
  updateAdmin,
  deleteAdmin,
  resendInvite,
} = require("../../controllers/administration/admin.controller");
const { requireRole } = require("../../middleware/verifyAdmin");

router.use(verifyAdmin);

router.post("/", requireRole("super_admin"), createAdmin);
router.get("/", getAllAdmins);
router.get("/:id", getAdminById);
router.patch("/:id", updateAdmin);
router.delete("/:id", requireRole("super_admin"), deleteAdmin);
router.post("/:id/resend-invite", resendInvite);

module.exports = router;
