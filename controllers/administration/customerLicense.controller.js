const asyncHandler = require("express-async-handler");
const { customerLicenseRepo } = require("../../repositories");
const storage = require("../../services/storage");
const {
  LicenseError,
  verify,
  reject,
  toPublic,
} = require("../../services/customerLicense.service");
const { emitEvent } = require("../../services/events");

// Staff license registry: /api/customer-licenses — one place to review and
// manage every customer's licenses. Verifying/rejecting here applies to every
// order that references the license.

const load = async (req, res) => {
  const license = await customerLicenseRepo.findById(Number(req.params.id));
  if (!license) {
    res.status(404).json({ success: false, message: "License not found" });
    return null;
  }
  return license;
};

const list = asyncHandler(async (req, res) => {
  const result = await customerLicenseRepo.findAll(req.query);
  res.json({ success: true, data: result });
});

const getById = asyncHandler(async (req, res) => {
  const license = await customerLicenseRepo.findByIdWithCustomer(Number(req.params.id));
  if (!license) return res.status(404).json({ success: false, message: "License not found" });
  res.json({ success: true, data: { license } });
});

const verifyLicense = asyncHandler(async (req, res) => {
  const license = await load(req, res);
  if (!license) return;
  if (license.status === "VERIFIED") {
    return res.status(409).json({ success: false, message: "License is already verified" });
  }
  try {
    const updated = await verify(customerLicenseRepo, {
      license,
      staffId: req.user.id,
      expiryDate: req.body.expiryDate,
    });
    emitEvent("customer_license.verified", {
      licenseId: license.id,
      customerId: license.customerId,
      staffId: req.user.id,
    });
    res.json({ success: true, message: "License verified", data: { license: toPublic(updated) } });
  } catch (err) {
    if (err instanceof LicenseError) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
    throw err;
  }
});

const rejectLicense = asyncHandler(async (req, res) => {
  const license = await load(req, res);
  if (!license) return;
  const updated = await reject(customerLicenseRepo, {
    license,
    staffId: req.user.id,
    comment: req.body.comment || "",
  });
  emitEvent("customer_license.rejected", {
    licenseId: license.id,
    customerId: license.customerId,
    staffId: req.user.id,
    comment: req.body.comment || "",
  });
  res.json({ success: true, message: "License rejected", data: { license: toPublic(updated) } });
});

const download = asyncHandler(async (req, res) => {
  const license = await load(req, res);
  if (!license) return;
  emitEvent("customer_license.downloaded", { licenseId: license.id, staffId: req.user.id });
  const url = await storage.presignGet(license.storageKey, 300, {
    resourceType: license.storageResourceType || undefined,
  });
  if (url) return res.redirect(302, url);
  const { stream, contentLength } = await storage.getStream(license.storageKey);
  res.setHeader("Content-Type", license.mimeType);
  if (contentLength) res.setHeader("Content-Length", contentLength);
  res.setHeader("Content-Disposition", `inline; filename="${license.fileName.replace(/[^\w.\- ]/g, "_")}"`);
  stream.pipe(res);
});

module.exports = { list, getById, verifyLicense, rejectLicense, download };
