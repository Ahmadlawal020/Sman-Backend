const { z } = require("zod");

const phoneSchema = z.string().min(1, "Phone number is required").max(20);
const emailSchema = z.string().email("Invalid email").max(320);
const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(200);
const pinSchema = z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits");

const setPasswordSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

const passwordLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  deviceToken: z.string().max(200).optional(),
});

const passwordStepUpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().min(1).max(10),
  trustDevice: z.boolean().optional(),
  deviceName: z.string().max(255).optional(),
});

const setPinSchema = z.object({ pin: pinSchema });

const pinLoginSchema = z
  .object({
    // Either identifier resolves the same account. Both optional at the field
    // level so the refine below can emit one clear message instead of two.
    phone: phoneSchema.optional(),
    email: z.string().trim().toLowerCase().email("Enter a valid email address").max(255).optional(),
    pin: z.string().min(1).max(6),
    deviceToken: z.string().min(1, "This device is not trusted for PIN sign-in").max(200),
  })
  .refine((v) => Boolean(v.phone || v.email), {
    message: "Enter your phone number or email address",
    path: ["phone"],
  });

const providerParamSchema = z.object({
  provider: z.enum(["google", "apple"]),
});

const providerLoginSchema = z.object({
  idToken: z.string().min(1, "idToken is required").max(8000),
});

const providerRegisterSchema = z.object({
  registrationToken: z.string().min(1).max(8000),
  phone: phoneSchema,
  name: z.string().max(200).optional(),
});

const deviceIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const passkeyRegisterVerifySchema = z.object({
  credential: z.record(z.any()),
  deviceName: z.string().max(255).optional(),
});

const passkeyLoginVerifySchema = z.object({
  credential: z.record(z.any()),
});

module.exports = {
  setPasswordSchema,
  passwordLoginSchema,
  passwordStepUpVerifySchema,
  setPinSchema,
  pinLoginSchema,
  providerParamSchema,
  providerLoginSchema,
  providerRegisterSchema,
  deviceIdParamSchema,
  passkeyRegisterVerifySchema,
  passkeyLoginVerifySchema,
};
