const asyncHandler = require("express-async-handler");
const { customerLicenseRepo } = require("../../repositories");
const { generateSignature } = require("../../services/upload.service");

/**
 * GET /api/customer/licenses — the signed-in customer's own license register,
 * newest first. The wizard's picker: an approved, unexpired license can be
 * attached to a new Dangote quote request without another upload.
 */
const listMyLicenses = asyncHandler(async (req, res) => {
  const licenses = await customerLicenseRepo.findByCustomerId(req.customer.id);
  res.json({ success: true, data: { licenses } });
});

/**
 * POST /api/customer/licenses — register a license on the customer's own
 * account. The file itself goes directly to Cloudinary (see the signature
 * endpoint); this records the resulting URL. Lands as pending — staff verify
 * it from the existing /api/customer-licenses desk.
 */
const createMyLicense = asyncHandler(async (req, res) => {
  const { companyName, licenseUrl, licensePublicId, expiryDate } = req.body;

  const license = await customerLicenseRepo.create({
    customerId: req.customer.id,
    companyName,
    licenseUrl: licenseUrl || "",
    licensePublicId: licensePublicId || "",
    expiryDate: expiryDate || null,
  });

  res.status(201).json({
    success: true,
    message: "License added successfully",
    data: { license },
  });
});

/**
 * GET /api/customer/licenses/upload-signature — a signed payload for a
 * direct-to-Cloudinary upload of the customer's license document. Mirrors
 * the staff /api/uploads/signature endpoint, pinned to the licenses folder.
 */
const getUploadSignature = asyncHandler(async (req, res) => {
  if (!process.env.CLOUDINARY_API_SECRET || !process.env.CLOUDINARY_CLOUD_NAME) {
    return res.status(503).json({
      success: false,
      message: "Document uploads are not available right now. You can submit without the file and add it later.",
    });
  }
  const params = generateSignature({ folder: "soroman/licenses", resourceType: "auto" });
  res.json({ success: true, data: params });
});

module.exports = { listMyLicenses, createMyLicense, getUploadSignature };
