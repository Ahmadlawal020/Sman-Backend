const crypto = require("crypto");
const asyncHandler = require("express-async-handler");
const { staffRepo } = require("../../repositories");
const { mapRolesToBackend } = require("../../config/roleMapping");
const { sendPasswordSetupEmail } = require("../../services/email.service");

const generateResetToken = () => {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");
  return { rawToken, hashedToken };
};

const createAdmin = asyncHandler(async (req, res) => {
  const { first_name, surname, other_names, email, phone_number, roles, suspended } = req.body;

  if (!first_name || !surname || !email) {
    return res.status(400).json({
      success: false,
      message: "First name, surname, and email are required",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await staffRepo.findByEmail(normalizedEmail);
  if (existing) {
    return res.status(409).json({
      success: false,
      message: "A user with this email already exists",
    });
  }

  const { rawToken, hashedToken } = generateResetToken();

  const backendRoles = roles && roles.length > 0
    ? mapRolesToBackend(roles)
    : ["admin"];

  const admin = await staffRepo.create({
    firstName: first_name.trim(),
    surname: surname.trim(),
    otherNames: (other_names || "").trim(),
    email: normalizedEmail,
    phoneNumber: phone_number || null,
    roles: backendRoles,
    suspended: suspended || false,
    isPasswordSet: false,
    passwordResetToken: hashedToken,
    passwordResetExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  try {
    await sendPasswordSetupEmail(normalizedEmail, rawToken, admin.firstName);
  } catch (emailErr) {
    console.error("Failed to send password setup email:", emailErr);
  }

  res.status(201).json({
    success: true,
    message: "User created successfully. A password setup email has been sent.",
    data: {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      surname: admin.surname,
      roles: admin.roles,
    },
  });
});

const getAllAdmins = asyncHandler(async (req, res) => {
  const { staff, pagination } = await staffRepo.findAll({ page: 1, limit: 1000 });

  const safeStaff = staff.map(({ password, refreshToken, passwordResetToken, passwordResetExpires, ...rest }) => rest);

  res.json({
    success: true,
    // dual-emit: `staff` is the new key, `admins` retained for the existing frontend.
    // Drop `admins` once the dashboard is updated.
    data: { staff: safeStaff, admins: safeStaff },
  });
});

const getAdminById = asyncHandler(async (req, res) => {
  const admin = await staffRepo.findById(req.params.id);

  if (!admin) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const { password, refreshToken, passwordResetToken, passwordResetExpires, ...safeAdmin } = admin;

  res.json({
    success: true,
    data: { admin: safeAdmin },
  });
});

const updateAdmin = asyncHandler(async (req, res) => {
  const { first_name, surname, other_names, email, phone_number, roles, suspended } = req.body;

  const admin = await staffRepo.findById(req.params.id);
  if (!admin) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  // --- AUDIT H5: privilege escalation ------------------------------------
  //
  // This endpoint edits ordinary profile fields AND the two fields that decide
  // what an account may do. It carried no role gate, so any `admin` could
  // PATCH their own row with roles:[0] and become a super_admin — defeating
  // the super_admin gates on create and delete.
  //
  // The gate is per-field rather than per-route on purpose. Putting
  // requireRole("super_admin") on the route would fix the escalation and break
  // every staff member's ability to edit their own name and phone number.
  const isSuperAdmin = (req.user?.roles || []).includes("super_admin");
  const changesPrivileges = roles !== undefined || suspended !== undefined;

  if (changesPrivileges && !isSuperAdmin) {
    return res.status(403).json({
      success: false,
      message: "Only a super admin can change roles or suspension",
    });
  }

  // A super_admin locking themselves out takes everyone with them: the roles
  // that can restore access are exactly the ones being given away.
  if (changesPrivileges && admin.id === req.user.id) {
    if (suspended === true) {
      return res.status(400).json({
        success: false,
        message: "You cannot suspend your own account",
      });
    }
    if (roles && roles.length > 0 && !mapRolesToBackend(roles).includes("super_admin")) {
      return res.status(400).json({
        success: false,
        message: "You cannot remove your own super admin role",
      });
    }
  }

  const updateData = {};
  if (first_name) updateData.firstName = first_name.trim();
  if (surname) updateData.surname = surname.trim();
  if (other_names !== undefined) updateData.otherNames = (other_names || "").trim();
  if (email) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await staffRepo.findByEmail(normalizedEmail);
    if (existing && existing.id !== admin.id) {
      return res.status(409).json({ success: false, message: "Email already in use" });
    }
    updateData.email = normalizedEmail;
  }
  if (phone_number !== undefined) updateData.phoneNumber = phone_number || null;
  if (roles && roles.length > 0) updateData.roles = mapRolesToBackend(roles);
  if (suspended !== undefined) updateData.suspended = suspended;

  const updated = await staffRepo.update(admin.id, updateData);

  res.json({
    success: true,
    message: "User updated successfully",
    data: {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      surname: updated.surname,
      roles: updated.roles,
    },
  });
});

const deleteAdmin = asyncHandler(async (req, res) => {
  const admin = await staffRepo.findById(req.params.id);
  if (!admin) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  await staffRepo.deleteById(req.params.id);

  res.json({
    success: true,
    message: "User deleted successfully",
  });
});

const resendInvite = asyncHandler(async (req, res) => {
  const admin = await staffRepo.findById(req.params.id);
  if (!admin) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  if (admin.isPasswordSet) {
    return res.status(400).json({
      success: false,
      message: "User has already set their password",
    });
  }

  const { rawToken, hashedToken } = generateResetToken();
  await staffRepo.update(admin.id, {
    passwordResetToken: hashedToken,
    passwordResetExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  try {
    await sendPasswordSetupEmail(admin.email, rawToken, admin.firstName);
  } catch (emailErr) {
    console.error("Failed to resend password setup email:", emailErr);
    return res.status(500).json({
      success: false,
      message: "Failed to send email",
    });
  }

  res.json({
    success: true,
    message: "Password setup email resent successfully",
  });
});

module.exports = {
  createAdmin,
  getAllAdmins,
  getAdminById,
  updateAdmin,
  deleteAdmin,
  resendInvite,
};
