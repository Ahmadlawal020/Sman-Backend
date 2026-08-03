const z = require("zod");

// The Cloudinary public_id of a previously uploaded asset, plus the resource
// kind so the destroy call targets the right store. publicId is bounded but
// otherwise opaque; the controller enforces WHERE it may point (own folder).
const deleteUpload = z.object({
  publicId: z
    .string({ error: "publicId is required" })
    .trim()
    .min(1, "publicId is required")
    .max(500, "publicId is too long"),
  resourceType: z.enum(["image", "raw", "video", "auto"]).optional(),
});

module.exports = { deleteUpload };
