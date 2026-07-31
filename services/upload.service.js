const crypto = require("crypto");
const cloudinary = require("../config/cloudinary");

/**
 * Generate a signed upload signature for direct frontend-to-Cloudinary uploads.
 *
 * The client POSTs the file to Cloudinary's upload endpoint along with these
 * params. Cloudinary verifies the signature server-side, so the API secret
 * never leaves the backend.
 *
 * @param {object} opts
 * @param {string} [opts.folder="soroman"]  Cloudinary folder
 * @param {string} [opts.resourceType="auto"]  auto | image | raw | video
 * @returns {{ timestamp, signature, apiKey, cloudName, folder }}
 */
function generateSignature({ folder = "soroman", resourceType = "auto" } = {}) {
  const timestamp = Math.round(Date.now() / 1000);

  // Params that will be signed. Cloudinary requires the params sorted
  // alphabetically and joined with `&` for signing.
  const paramsToSign = { folder, timestamp };
  const sortedKeys = Object.keys(paramsToSign).sort();
  const signString = sortedKeys
    .map((key) => `${key}=${paramsToSign[key]}`)
    .join("&") + process.env.CLOUDINARY_API_SECRET;

  const signature = crypto
    .createHash("sha1")
    .update(signString)
    .digest("hex");

  return {
    timestamp,
    signature,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    folder,
    resourceType,
  };
}

/**
 * Delete a file from Cloudinary by its public ID.
 *
 * @param {string} publicId  The Cloudinary public_id to delete
 * @param {string} [resourceType="image"]
 * @returns {Promise<object>}  Cloudinary deletion result
 */
async function deleteFile(publicId, resourceType = "image") {
  if (!publicId) return null;
  return cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
  });
}

module.exports = { generateSignature, deleteFile };
