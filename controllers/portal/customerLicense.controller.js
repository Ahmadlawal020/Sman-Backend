const asyncHandler = require("express-async-handler");
const { customerLicenseRepo } = require("../../repositories");
const storage = require("../../services/storage");
const {
  LicenseError,
  createFromUpload,
  createFromDirectUpload,
  removeLicense,
  toPublic,
} = require("../../services/customerLicense.service");
const { normalizeCompanyName } = require("../../services/dangoteDelivery/orders");

// The signed-in customer's own license register. General (not Dangote-
// specific); the Dangote order flow references these via license_id.

const handle = (err, res) => {
  if (err instanceof LicenseError) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
    return true;
  }
  return false;
};

const loadOwn = async (req, res) => {
  const license = await customerLicenseRepo.findById(Number(req.params.id));
  if (!license || license.customerId !== req.customer.id) {
    res.status(404).json({ success: false, message: "License not found" });
    return null;
  }
  return license;
};

const listMine = asyncHandler(async (req, res) => {
  const licenses = await customerLicenseRepo.findByCustomer(req.customer.id);
  res.json({ success: true, data: { licenses: licenses.map(toPublic) } });
});

// The reuse offer for a company: my verified, unexpired license, if any.
const reusableForCompany = asyncHandler(async (req, res) => {
  const normalized = normalizeCompanyName(req.query.company);
  const license = await customerLicenseRepo.findReusable(req.customer.id, normalized);
  res.json({ success: true, data: { license: license ? toPublic(license) : null } });
});

// Direct-upload (cloudinary) only: a signed payload the client posts to the store.
const uploadSignature = asyncHandler(async (req, res) => {
  if (storage.MODE !== "direct") {
    return res.status(409).json({
      success: false,
      message: "Direct upload is not enabled; POST the file to this endpoint instead",
    });
  }
  const payload = storage.signUpload({ folder: "soroman/licenses" });
  res.json({ success: true, data: payload });
});

// Create a license. Backend mode: multipart file. Direct mode: a client-
// reported upload { publicId, resourceType, fileName } to confirm + record.
const createMine = asyncHandler(async (req, res) => {
  const companyName = (req.body.companyName || "").trim();
  if (!companyName) {
    return res.status(400).json({ success: false, message: "Company name is required" });
  }
  const companyNameNormalized = normalizeCompanyName(companyName);

  try {
    let license;
    if (storage.MODE === "direct") {
      license = await createFromDirectUpload(customerLicenseRepo, {
        customer: req.customer,
        companyName,
        companyNameNormalized,
        publicId: req.body.publicId,
        resourceType: req.body.resourceType,
        fileName: req.body.fileName,
      });
    } else {
      license = await createFromUpload(customerLicenseRepo, {
        customer: req.customer,
        companyName,
        companyNameNormalized,
        file: req.file,
      });
    }
    res.status(201).json({ success: true, data: { license: toPublic(license) } });
  } catch (err) {
    if (handle(err, res)) return;
    throw err;
  }
});

const removeMine = asyncHandler(async (req, res) => {
  const license = await loadOwn(req, res);
  if (!license) return;
  // A verified license may be referenced by orders — keep it; only pending or
  // rejected uploads are removable by the customer.
  if (license.status === "VERIFIED") {
    return res.status(409).json({
      success: false,
      message: "A verified license can't be removed; contact support to replace it",
    });
  }
  await removeLicense(customerLicenseRepo, license);
  res.json({ success: true, message: "License removed" });
});

const downloadMine = asyncHandler(async (req, res) => {
  const license = await loadOwn(req, res);
  if (!license) return;
  const url = await storage.presignGet(license.storageKey, 300, {
    resourceType: license.storageResourceType || undefined,
    format: undefined,
  });
  if (url) return res.redirect(302, url);
  const { stream, contentLength } = await storage.getStream(license.storageKey);
  res.setHeader("Content-Type", license.mimeType);
  if (contentLength) res.setHeader("Content-Length", contentLength);
  res.setHeader("Content-Disposition", `inline; filename="${license.fileName.replace(/[^\w.\- ]/g, "_")}"`);
  stream.pipe(res);
});

module.exports = {
  listMine,
  reusableForCompany,
  uploadSignature,
  createMine,
  removeMine,
  downloadMine,
};
