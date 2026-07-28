const z = require("zod");
const { requiredString, optionalString, optionalEmail } = require("./fields");

/**
 * What a customer may change about themselves: identity-adjacent text fields
 * only. Phone is deliberately absent — changing it revokes every session and
 * has its own flow. Status, balance, and the virtual account are staff/system
 * facts a customer can never write.
 */
const updateProfile = z
  .object({
    name: requiredString("Name", 255).optional(),
    companyName: optionalString("Company name", 255),
    email: optionalEmail("Email"),
    address: z.string().trim().max(2000, "Address is too long").optional(),
  })
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), {
    message: "Nothing to update",
  });

module.exports = { updateProfile };
