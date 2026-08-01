const crypto = require("node:crypto");
const cloudinary = require("../../config/cloudinary");

// Direct-upload storage: the client uploads straight to Cloudinary using a
// backend-signed payload, so the bytes never transit our server. Unlike a
// naive Cloudinary integration, every asset is stored as `type: authenticated`
// — NOT publicly readable. Downloads are short-lived signed URLs, matching the
// S3 driver's posture. Compliance documents are never on a guessable public URL.
//
// The backend can't magic-byte sniff a file it never sees, so validation moves
// to two places: the signed params pin the folder/type, and verifyUploaded()
// confirms format + size against the Cloudinary Admin API before any DB row is
// written (the caller deletes the asset if it fails).

const ALLOWED = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};
const MAX_BYTES = 10 * 1024 * 1024;

const secret = () => {
  const s = process.env.CLOUDINARY_API_SECRET;
  if (!s) throw new Error("CLOUDINARY_API_SECRET is not set but STORAGE_DRIVER=cloudinary");
  return s;
};

/**
 * A signed payload the client posts directly to Cloudinary. We sign exactly
 * the params the client will send (sorted, joined, secret appended) — the API
 * secret never leaves the backend. `type: authenticated` makes the stored
 * asset private.
 */
const signUpload = ({ folder = "soroman/dangote-licenses" } = {}) => {
  const timestamp = Math.round(Date.now() / 1000);
  const params = { folder, timestamp, type: "authenticated" };
  const toSign =
    Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&") + secret();
  const signature = crypto.createHash("sha1").update(toSign).digest("hex");
  return {
    provider: "cloudinary",
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    type: "authenticated",
    signature,
    // Client uploads to /auto/upload; Cloudinary reports the real resource_type back.
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/auto/upload`,
  };
};

/**
 * Confirm a client-reported upload against the Admin API before trusting it.
 * Returns { mimeType, bytes, resourceType, format }, or throws with a reason.
 */
const verifyUploaded = async (publicId, { resourceType = "image" } = {}) => {
  const res = await cloudinary.api.resource(publicId, {
    resource_type: resourceType,
    type: "authenticated",
  });
  const format = String(res.format || "").toLowerCase();
  const mimeType = ALLOWED[format];
  if (!mimeType) {
    const err = new Error("Only PDF, JPG, or PNG documents are accepted");
    err.invalidUpload = true;
    throw err;
  }
  if (res.bytes > MAX_BYTES) {
    const err = new Error("Documents must be 10MB or smaller");
    err.invalidUpload = true;
    throw err;
  }
  return { mimeType, bytes: res.bytes, resourceType, format };
};

/** Short-lived signed download URL for a private asset (presignGet analogue). */
const presignGet = async (publicId, ttlSeconds = 300, { resourceType = "image", format } = {}) => {
  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: resourceType,
    type: "authenticated",
    expires_at: Math.round(Date.now() / 1000) + ttlSeconds,
  });
};

const remove = async (publicId, { resourceType = "image" } = {}) => {
  await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
    type: "authenticated",
  });
};

// Direct-upload only — the backend never receives bytes to put or stream.
const put = async () => {
  throw new Error("cloudinaryDriver is direct-upload only; use signUpload()");
};
const getStream = async () => {
  throw new Error("cloudinaryDriver serves downloads via presignGet(), not getStream()");
};

module.exports = {
  mode: "direct",
  ALLOWED,
  MAX_BYTES,
  signUpload,
  verifyUploaded,
  presignGet,
  remove,
  put,
  getStream,
};
