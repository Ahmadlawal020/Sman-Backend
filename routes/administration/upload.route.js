const express = require("express");
const router = express.Router();
const asyncHandler = require("express-async-handler");
const verifyStaff = require("../../middleware/verifyStaff");
const { generateSignature, deleteFile } = require("../../services/upload.service");

/**
 * GET /api/uploads/signature
 *
 * Returns a signed upload payload the client uses to POST a file directly
 * to Cloudinary. The API secret is never exposed to the frontend.
 */
router.get(
  "/signature",
  verifyStaff,
  asyncHandler(async (req, res) => {
    const folder = req.query.folder || "soroman";
    const resourceType = req.query.resourceType || "auto";

    const params = generateSignature({ folder, resourceType });

    res.json({ success: true, data: params });
  })
);

/**
 * POST /api/uploads/delete
 *
 * Deletes a file from Cloudinary by public ID. Used for cleanup when a
 * license (or other entity) is removed or its file is replaced.
 */
router.post(
  "/delete",
  verifyStaff,
  asyncHandler(async (req, res) => {
    const { publicId, resourceType } = req.body;

    if (!publicId) {
      return res
        .status(400)
        .json({ success: false, message: "publicId is required" });
    }

    const result = await deleteFile(publicId, resourceType || "image");
    res.json({ success: true, data: result });
  })
);

module.exports = router;
