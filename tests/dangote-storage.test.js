// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

// The storage facade reads STORAGE_DRIVER at module-load, so exercise the
// default (local) facade wiring and the cloudinary driver's pure signing
// logic directly. The Cloudinary Admin-API paths (verifyUploaded/presignGet)
// are integration-covered in the license e2e with the SDK mocked.

describe("storage facade — driver selection and direct-upload guard", () => {
  test("default is a backend driver; direct-only methods throw a clear error", () => {
    // No STORAGE_DRIVER set in the test env → local disk, mode backend.
    const storage = require("../services/storage");
    assert.equal(storage.MODE, "backend");
    assert.equal(typeof storage.put, "function");
    assert.throws(() => storage.signUpload(), /direct-upload driver/);
    assert.throws(() => storage.verifyUploaded(), /direct-upload driver/);
  });
});

describe("cloudinary driver — signed direct upload", () => {
  before(() => {
    process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "test-cloud";
    process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "test-key";
    process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "test-secret";
  });

  test("declares direct mode and refuses backend-only methods", async () => {
    const d = require("../services/storage/cloudinaryDriver");
    assert.equal(d.mode, "direct");
    await assert.rejects(() => d.put(), /direct-upload only/);
    await assert.rejects(() => d.getStream(), /presignGet/);
  });

  test("signUpload produces a private (authenticated) payload with a valid signature", () => {
    const d = require("../services/storage/cloudinaryDriver");
    const p = d.signUpload({ folder: "soroman/dangote-licenses" });

    assert.equal(p.provider, "cloudinary");
    assert.equal(p.type, "authenticated", "assets must be private, never public");
    assert.equal(p.folder, "soroman/dangote-licenses");
    assert.equal(p.cloudName, process.env.CLOUDINARY_CLOUD_NAME);
    assert.equal(p.apiKey, process.env.CLOUDINARY_API_KEY);
    assert.match(p.uploadUrl, /\/v1_1\/.*\/auto\/upload$/);

    // Recompute the signature exactly as Cloudinary will verify it: the signed
    // params sorted, joined with &, secret appended, SHA1 hex.
    const toSign =
      `folder=${p.folder}&timestamp=${p.timestamp}&type=authenticated` +
      process.env.CLOUDINARY_API_SECRET;
    const expected = crypto.createHash("sha1").update(toSign).digest("hex");
    assert.equal(p.signature, expected, "signature must match Cloudinary's scheme");
  });

  test("enforces the same PDF/JPG/PNG + 10MB contract as the backend driver", () => {
    const d = require("../services/storage/cloudinaryDriver");
    assert.equal(d.MAX_BYTES, 10 * 1024 * 1024);
    assert.deepEqual(Object.keys(d.ALLOWED).sort(), ["jpeg", "jpg", "pdf", "png"]);
    assert.equal(d.ALLOWED.pdf, "application/pdf");
    assert.equal(d.ALLOWED.png, "image/png");
  });
});
