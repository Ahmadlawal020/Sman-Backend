// Must precede any require that reaches config/db, which reads DATABASE_URL at
// module load (same rule as the other test files).
require("dotenv").config();

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  DOCUMENT_MAX_BYTES,
  DocumentError,
  sniffMime,
  validateUpload,
  buildStorageKey,
} = require("../services/dangoteDelivery/documents");

const pdfBuffer = () => Buffer.from("%PDF-1.7\nfake body");
const jpegBuffer = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const pngBuffer = () =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

describe("dangote document validation", () => {
  test("sniffs PDF, JPEG, and PNG by magic bytes", () => {
    assert.equal(sniffMime(pdfBuffer()), "application/pdf");
    assert.equal(sniffMime(jpegBuffer()), "image/jpeg");
    assert.equal(sniffMime(pngBuffer()), "image/png");
  });

  test("rejects content that only pretends by extension or header", () => {
    assert.equal(sniffMime(Buffer.from("<html>not a pdf</html>")), null);
    assert.equal(sniffMime(Buffer.from("GIF89a......")), null);
    assert.equal(sniffMime(Buffer.alloc(0)), null);
  });

  test("accepts a valid upload and returns the sniffed mime", () => {
    const mime = validateUpload({
      buffer: pdfBuffer(),
      size: pdfBuffer().length,
      documentType: "DPR_NUPRC_LICENSE",
    });
    assert.equal(mime, "application/pdf");
  });

  test("rejects unknown document types", () => {
    assert.throws(
      () => validateUpload({ buffer: pdfBuffer(), size: 10, documentType: "PASSPORT" }),
      DocumentError
    );
  });

  test("rejects empty and oversized files", () => {
    assert.throws(
      () => validateUpload({ buffer: Buffer.alloc(0), size: 0, documentType: "DPR_NUPRC_LICENSE" }),
      /empty/
    );
    assert.throws(
      () =>
        validateUpload({
          buffer: pdfBuffer(),
          size: DOCUMENT_MAX_BYTES + 1,
          documentType: "DPR_NUPRC_LICENSE",
        }),
      /10MB/
    );
  });

  test("rejects disguised content regardless of client claims", () => {
    assert.throws(
      () =>
        validateUpload({
          buffer: Buffer.from("#!/bin/sh\nrm -rf /"),
          size: 20,
          documentType: "DPR_NUPRC_LICENSE",
        }),
      /PDF, JPG, or PNG/
    );
  });

  test("storage keys are namespaced and unguessable", () => {
    const key = buildStorageKey(42, 7, "application/pdf");
    assert.match(
      key,
      /^dangote-delivery\/42\/7\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/
    );
    assert.notEqual(key, buildStorageKey(42, 7, "application/pdf"));
  });
});
