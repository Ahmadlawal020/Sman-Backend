const crypto = require("node:crypto");
const storage = require("./storage");

// Customer license register — upload (backend-mediated or client-direct),
// staff verification, and the reuse offer. Deliberately storage-driver
// agnostic: a backend driver (s3/local) receives bytes and put()s them; the
// direct driver (cloudinary) is fed a client-reported upload that we confirm
// against its Admin API before trusting. Each row records its storage_provider
// so downloads/deletes route to the right driver.

const LICENSE_MAX_BYTES = 10 * 1024 * 1024;
const MIME_EXTENSIONS = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

class LicenseError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "LicenseError";
    this.statusCode = statusCode;
  }
}

// Magic-byte sniff (client filename / Content-Type are untrusted). Used only
// in backend-upload mode; the direct driver validates via its Admin API.
const sniffMime = (buffer) => {
  if (!buffer || buffer.length < 8) return null;
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  return null;
};

const buildStorageKey = (customerId, mime) =>
  `licenses/${customerId}/${crypto.randomUUID()}.${MIME_EXTENSIONS[mime]}`;

/** Backend-mediated upload (s3/local): validate bytes, put, create the row. */
const createFromUpload = async (repo, { customer, companyName, companyNameNormalized, file }) => {
  if (!file || !file.buffer || !file.size) {
    throw new LicenseError("A license file is required");
  }
  if (file.size > LICENSE_MAX_BYTES) {
    throw new LicenseError("Documents must be 10MB or smaller");
  }
  const mime = sniffMime(file.buffer);
  if (!mime) {
    throw new LicenseError("Only PDF, JPG, or PNG documents are accepted");
  }
  const storageKey = buildStorageKey(customer.id, mime);
  await storage.put(storageKey, file.buffer, { contentType: mime });

  try {
    return await repo.create({
      customerId: customer.id,
      companyName,
      companyNameNormalized,
      storageKey,
      storageProvider: storage.DRIVER,
      storageResourceType: "",
      fileName: (file.originalname || "license").slice(0, 255),
      mimeType: mime,
      fileSize: file.size,
      status: "PENDING",
    });
  } catch (err) {
    await storage.remove(storageKey).catch(() => {});
    throw err;
  }
};

/**
 * Client-direct upload (cloudinary): the client already uploaded to the store;
 * confirm format + size against the Admin API before writing the row. The
 * caller never sees the bytes.
 */
const createFromDirectUpload = async (
  repo,
  { customer, companyName, companyNameNormalized, publicId, resourceType, fileName }
) => {
  if (!publicId) throw new LicenseError("Missing upload reference");
  let meta;
  try {
    meta = await storage.verifyUploaded(publicId, { resourceType });
  } catch (err) {
    if (err.invalidUpload) {
      await storage.remove(publicId, { resourceType }).catch(() => {});
      throw new LicenseError(err.message);
    }
    throw err;
  }
  return repo.create({
    customerId: customer.id,
    companyName,
    companyNameNormalized,
    storageKey: publicId,
    storageProvider: "cloudinary",
    storageResourceType: resourceType || "image",
    fileName: (fileName || "license").slice(0, 255),
    mimeType: meta.mimeType,
    fileSize: meta.bytes,
    status: "PENDING",
  });
};

/**
 * Staff verification. Expiry is REQUIRED (DPR/NUPRC licenses are valid one
 * year and the date is printed on the certificate). Verifying here applies to
 * every order that references this license.
 */
const verify = async (repo, { license, staffId, staffName, expiryDate }) => {
  const parsed = new Date(expiryDate);
  if (!expiryDate || Number.isNaN(parsed.getTime())) {
    throw new LicenseError("A valid expiry date (as printed on the certificate) is required");
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (parsed < today) {
    throw new LicenseError("The certificate has already expired; it cannot be verified");
  }
  return repo.update(license.id, {
    status: "VERIFIED",
    verifiedBy: staffId,
    verifiedAt: new Date(),
    expiryDate,
    verificationComment: "",
  });
};

const reject = async (repo, { license, staffId, comment }) => {
  return repo.update(license.id, {
    status: "REJECTED",
    verifiedBy: staffId,
    verifiedAt: new Date(),
    verificationComment: comment || "",
  });
};

const isUsable = (license) =>
  !!license &&
  license.status === "VERIFIED" &&
  (!license.expiryDate || new Date(license.expiryDate) >= new Date(new Date().toDateString()));

/** Remove a license row and its stored object (routes to the right driver). */
const removeLicense = async (repo, license) => {
  await repo.deleteById(license.id);
  await storage
    .remove(license.storageKey, { resourceType: license.storageResourceType || undefined })
    .catch((err) => console.error(`[license] object cleanup failed ${license.storageKey}:`, err.message));
};

/** What API responses expose — never the storage key. */
const toPublic = (l) => ({
  id: l.id,
  customerId: l.customerId,
  companyName: l.companyName,
  fileName: l.fileName,
  fileSize: l.fileSize,
  mimeType: l.mimeType,
  status: l.status,
  expiryDate: l.expiryDate,
  verifiedAt: l.verifiedAt,
  verificationComment: l.verificationComment,
  createdAt: l.createdAt,
});

module.exports = {
  LICENSE_MAX_BYTES,
  LicenseError,
  sniffMime,
  buildStorageKey,
  createFromUpload,
  createFromDirectUpload,
  verify,
  reject,
  isUsable,
  removeLicense,
  toPublic,
};
