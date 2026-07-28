const z = require("zod");
const { requiredString, optionalEmail } = require("./fields");

/**
 * What a customer may change about themselves: identity-adjacent text fields
 * only. Phone is deliberately absent — changing it revokes every session and
 * has its own flow. Status, balance, and the virtual account are staff/system
 * facts a customer can never write.
 *
 * NOT fields.optionalString here: its `.transform(v => v ?? "")` materialises
 * absent keys as "", which would make an empty (or all-forbidden-keys) patch
 * indistinguishable from a real one and defeat the refine below. An absent
 * field must stay absent; an explicit "" is a deliberate clear and passes.
 */
const updateProfile = z
  .object({
    name: requiredString("Name", 255).optional(),
    companyName: z
      .string()
      .trim()
      .max(255, "Company name must be 255 characters or fewer")
      .optional(),
    email: optionalEmail("Email"),
    address: z.string().trim().max(2000, "Address is too long").optional(),
  })
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), {
    message: "Nothing to update",
  });

module.exports = { updateProfile };
