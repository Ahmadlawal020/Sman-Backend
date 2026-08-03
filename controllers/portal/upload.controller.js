const asyncHandler = require("express-async-handler");
const { deleteFile } = require("../../services/upload.service");

// The only folder customer uploads land in — the signed-upload endpoint
// (GET /api/customer/licenses/upload-signature) pins every customer upload to
// soroman/licenses. Confining deletes to this prefix keeps a stray or crafted
// publicId from reaching staff assets or any other customer's folder. Within
// the bucket the ids are random and unguessable, matching the signed-upload
// trust model. Extend this list if customers ever upload elsewhere.
const DELETABLE_PREFIXES = ["soroman/licenses/"];

/**
 * POST /api/customer/uploads/delete — remove a file the customer uploaded
 * directly to Cloudinary (e.g. replacing a licence document before saving it).
 * Customer twin of the staff /api/uploads/delete, but scoped to the customer
 * upload folder so it can only ever touch the caller's own documents.
 */
const deleteMyUpload = asyncHandler(async (req, res) => {
  if (!process.env.CLOUDINARY_API_SECRET || !process.env.CLOUDINARY_CLOUD_NAME) {
    return res.status(503).json({
      success: false,
      message: "Document uploads are not available right now.",
    });
  }

  const { publicId, resourceType } = req.body;

  if (!DELETABLE_PREFIXES.some((prefix) => publicId.startsWith(prefix))) {
    return res.status(403).json({
      success: false,
      message: "You can only delete documents you uploaded.",
    });
  }

  const result = await deleteFile(publicId, resourceType || "image");
  res.json({ success: true, data: result });
});

module.exports = { deleteMyUpload };
