const crypto = require("node:crypto");
const storage = require("../storage");
const { recordEvent } = require("./transitions");

const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024; // mirrors frontend DOCUMENT_MAX_BYTES
const DOCUMENT_TYPES = ["DPR_NUPRC_LICENSE"];

// Extension comes from the SNIFFED type, never from the client's filename or
// Content-Type header — both are attacker-controlled.
const MIME_EXTENSIONS = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

class DocumentError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "DocumentError";
    this.statusCode = statusCode;
  }
}

/** Magic-byte sniff. Returns the real MIME type or null if unrecognized. */
const sniffMime = (buffer) => {
  if (!buffer || buffer.length < 8) return null;
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  return null;
};

/** Validate an upload; returns the sniffed MIME or throws DocumentError. */
const validateUpload = ({ buffer, size, documentType }) => {
  if (!DOCUMENT_TYPES.includes(documentType)) {
    throw new DocumentError(`Unknown document type: ${documentType}`);
  }
  if (!size || size <= 0) {
    throw new DocumentError("The uploaded file is empty");
  }
  if (size > DOCUMENT_MAX_BYTES) {
    throw new DocumentError("Documents must be 10MB or smaller");
  }
  const mime = sniffMime(buffer);
  if (!mime) {
    throw new DocumentError("Only PDF, JPG, or PNG documents are accepted");
  }
  return mime;
};

const buildStorageKey = (customerId, orderId, mime) =>
  `dangote-delivery/${customerId}/${orderId}/${crypto.randomUUID()}.${MIME_EXTENSIONS[mime]}`;

/** Delete an object only when no document row references its key anymore. */
const removeObjectIfUnreferenced = async (documentRepo, storageKey) => {
  const remaining = await documentRepo.countByStorageKey(storageKey);
  if (remaining === 0) {
    await storage.remove(storageKey).catch((err) => {
      // The DB row is already gone; a dangling object is a cleanup concern,
      // not a request failure.
      console.error(`[dangote-docs] failed to delete object ${storageKey}:`, err.message);
    });
  }
};

/**
 * Store an upload for an order: validate → put object → swap the live row for
 * this (order, type). Returns the new document row.
 */
const uploadDocument = async (documentRepo, { order, file, documentType, actor }) => {
  const mime = validateUpload({ buffer: file.buffer, size: file.size, documentType });
  const storageKey = buildStorageKey(order.customerId, order.id, mime);

  await storage.put(storageKey, file.buffer, { contentType: mime });

  const previous = await documentRepo.findLiveByOrderAndType(order.id, documentType);

  let created;
  try {
    created = await documentRepo.create({
      orderId: order.id,
      documentType,
      fileName: (file.originalname || "document").slice(0, 255),
      fileSize: file.size,
      mimeType: mime,
      storageKey,
      status: "PENDING",
    });
  } catch (err) {
    // Insert failed after the object landed — don't leave an orphan behind.
    await storage.remove(storageKey).catch(() => {});
    throw err;
  }

  if (previous) {
    await documentRepo.deleteById(previous.id);
    await removeObjectIfUnreferenced(documentRepo, previous.storageKey);
  }

  await recordEvent(order.id, "DOCUMENT_UPLOADED", {
    actorType: actor?.type || "customer",
    actorId: actor?.id || null,
    note: documentType,
  });

  return created;
};

/** Remove a document from a DRAFT order (and its object if unreferenced). */
const removeDocument = async (documentRepo, { order, document, actor }) => {
  await documentRepo.deleteById(document.id);
  await removeObjectIfUnreferenced(documentRepo, document.storageKey);
  await recordEvent(order.id, "DOCUMENT_REMOVED", {
    actorType: actor?.type || "customer",
    actorId: actor?.id || null,
    note: document.documentType,
  });
};

/**
 * Attach a customer's previously verified documents to a new order as
 * reference copies — same storage key, fresh rows, verification carried over.
 */
const reuseDocuments = async (documentRepo, { order, documents, actor }) => {
  const copies = [];
  for (const doc of documents) {
    const previous = await documentRepo.findLiveByOrderAndType(order.id, doc.documentType);
    const copy = await documentRepo.create({
      orderId: order.id,
      documentType: doc.documentType,
      fileName: doc.fileName,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      storageKey: doc.storageKey,
      status: "VERIFIED",
      verifiedBy: doc.verifiedBy,
      verifiedAt: doc.verifiedAt,
      expiryDate: doc.expiryDate,
    });
    if (previous) {
      await documentRepo.deleteById(previous.id);
      await removeObjectIfUnreferenced(documentRepo, previous.storageKey);
    }
    copies.push(copy);
  }
  await recordEvent(order.id, "DOCUMENTS_REUSED", {
    actorType: actor?.type || "customer",
    actorId: actor?.id || null,
    note: documents.map((d) => d.documentType).join(", "),
  });
  return copies;
};

/**
 * Staff verification. Expiry is REQUIRED: DPR/NUPRC (NMDPRA) licenses are
 * valid one year and the expiry date is printed on the certificate — staff
 * copy it from there.
 */
const verifyDocument = async (documentRepo, { document, staffId, expiryDate }) => {
  const parsed = new Date(expiryDate);
  if (!expiryDate || Number.isNaN(parsed.getTime())) {
    throw new DocumentError("A valid expiry date (as printed on the certificate) is required");
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (parsed < today) {
    throw new DocumentError("The certificate has already expired; it cannot be verified");
  }

  const updated = await documentRepo.update(document.id, {
    status: "VERIFIED",
    verifiedBy: staffId,
    verifiedAt: new Date(),
    expiryDate,
  });

  await recordEvent(document.orderId, "DOCUMENT_VERIFIED", {
    actorType: "staff",
    actorId: staffId,
    note: document.documentType,
  });

  return updated;
};

const rejectDocument = async (documentRepo, { document, staffId, note }) => {
  const updated = await documentRepo.update(document.id, {
    status: "REJECTED",
    verifiedBy: staffId,
    verifiedAt: new Date(),
  });

  await recordEvent(document.orderId, "DOCUMENT_REJECTED", {
    actorType: "staff",
    actorId: staffId,
    note: note || document.documentType,
  });

  return updated;
};

/** What API responses expose — never the storage key. */
const toPublic = (doc) => ({
  id: doc.id,
  dangoteDeliveryOrderId: doc.orderId,
  documentType: doc.documentType,
  fileName: doc.fileName,
  fileSize: doc.fileSize,
  mimeType: doc.mimeType,
  status: doc.status,
  verifiedAt: doc.verifiedAt,
  expiryDate: doc.expiryDate,
  createdAt: doc.createdAt,
});

module.exports = {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_TYPES,
  DocumentError,
  sniffMime,
  validateUpload,
  buildStorageKey,
  uploadDocument,
  removeDocument,
  reuseDocuments,
  verifyDocument,
  rejectDocument,
  toPublic,
};
