const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const asyncHandler = require("express-async-handler");
const { staffRepo } = require("../../repositories");
const { sendPasswordResetEmail } = require("../../services/email.service");

const generateTokens = (user) => {
  const { id, email, roles } = user;

  const accessToken = jwt.sign(
    { UserInfo: { id, email, roles } },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "15m" }
  );

  const refreshToken = jwt.sign(
    { id, email },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" }
  );

  return { accessToken, refreshToken };
};

const getAdminPayload = (user) => ({
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  surname: user.surname,
  roles: user.roles,
  profilePicture: {
    url: user.profilePictureUrl,
    publicId: user.profilePicturePublicId,
  },
});

const handleLogin = asyncHandler(async (req, res) => {
  let { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Email and password required" });
  }

  email = email.trim().toLowerCase();

  const foundAdmin = await staffRepo.findByEmail(email);
  if (!foundAdmin || !foundAdmin.isActive || foundAdmin.suspended) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });
  }

  const match = await staffRepo.comparePassword(foundAdmin, password);
  if (!match) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });
  }

  const { accessToken, refreshToken } = generateTokens(foundAdmin);
  await staffRepo.update(foundAdmin.id, {
    refreshToken,
    lastLoginAt: new Date(),
  });

  res.json({
    success: true,
    message: "Login successful",
    data: {
      user: getAdminPayload(foundAdmin),
      accessToken,
      refreshToken,
    },
  });
});

const handleRefreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res
      .status(400)
      .json({ success: false, message: "Refresh token required" });
  }

  const foundAdmin = await staffRepo.findByRefreshToken(refreshToken);
  if (!foundAdmin || !foundAdmin.isActive || foundAdmin.suspended) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  jwt.verify(
    refreshToken,
    process.env.REFRESH_TOKEN_SECRET,
    async (err, decoded) => {
      if (err || foundAdmin.email !== decoded.email) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }

      const { accessToken, refreshToken: newRefresh } =
        generateTokens(foundAdmin);
      await staffRepo.update(foundAdmin.id, { refreshToken: newRefresh });

      res.json({
        success: true,
        message: "Token refreshed",
        data: {
          user: getAdminPayload(foundAdmin),
          accessToken,
          refreshToken: newRefresh,
        },
      });
    }
  );
});

const handleLogout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (typeof refreshToken !== "string" || !refreshToken) return res.sendStatus(204);

  const foundAdmin = await staffRepo.findByRefreshToken(refreshToken);
  if (!foundAdmin) return res.sendStatus(204);

  await staffRepo.update(foundAdmin.id, { refreshToken: "" });

  res.status(200).json({ success: true, message: "Logged out" });
});

const handleSetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({
      success: false,
      message: "Token and password are required",
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 8 characters",
    });
  }

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const admin = await staffRepo.findByPasswordResetToken(hashedToken);
  if (!admin) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired token. Please request a new invitation.",
    });
  }

  await staffRepo.update(admin.id, {
    password,
    isPasswordSet: true,
    passwordResetToken: null,
    passwordResetExpires: null,
  });

  res.json({
    success: true,
    message: "Password set successfully. You can now log in.",
  });
});

const handleForgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res
      .status(400)
      .json({ success: false, message: "Email is required" });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const successResponse = () =>
    res.json({
      success: true,
      message:
        "If that email is registered, a password reset link has been sent.",
    });

  const foundAdmin = await staffRepo.findByEmail(normalizedEmail);
  if (!foundAdmin || !foundAdmin.isActive) {
    return successResponse();
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  await staffRepo.update(foundAdmin.id, {
    passwordResetToken: hashedToken,
    passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000),
  });

  try {
    await sendPasswordResetEmail(
      foundAdmin.email,
      rawToken,
      foundAdmin.firstName
    );
  } catch (emailErr) {
    console.error("Failed to send password reset email:", emailErr);
    return res.status(500).json({
      success: false,
      message: "Failed to send email. Please try again later.",
    });
  }

  return successResponse();
});

const handleGetMe = asyncHandler(async (req, res) => {
  const admin = await staffRepo.findById(req.user.id);
  if (!admin) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const { password, refreshToken, passwordResetToken, passwordResetExpires, ...safeAdmin } = admin;

  res.json({
    success: true,
    data: { user: safeAdmin },
  });
});

module.exports = {
  handleLogin,
  handleRefreshToken,
  handleLogout,
  handleGetMe,
  handleSetPassword,
  handleForgotPassword,
};
