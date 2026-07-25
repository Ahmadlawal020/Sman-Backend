const { z } = require("zod");

const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Invalid email format")
    .max(255, "Email too long")
    .transform((s) => s.trim().toLowerCase()),
  password: z
    .string()
    .min(1, "Password is required")
    .max(128, "Password too long"),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

const setPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password too long"),
});

const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Invalid email format")
    .max(255, "Email too long")
    .transform((s) => s.trim().toLowerCase()),
});

module.exports = {
  loginSchema,
  refreshTokenSchema,
  setPasswordSchema,
  forgotPasswordSchema,
};
