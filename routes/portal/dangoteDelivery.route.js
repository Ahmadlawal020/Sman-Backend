const express = require("express");
const multer = require("multer");
const router = express.Router();
const { authenticateCustomer, requireActiveCustomer } = require("../../middleware/verifyCustomer");
const { requireCsrfForCookieAuth } = require("../../middleware/csrf");
const generateLimiter = require("../../middleware/generateLimiter");
const { DOCUMENT_MAX_BYTES } = require("../../services/dangoteDelivery/documents");
const {
  uploadMyDocument,
  listMyDocuments,
  removeMyDocument,
  downloadMyDocument,
} = require("../../controllers/portal/dangoteDelivery.controller");

// Customer-scoped Dangote delivery orders. This router carries the document
// endpoints (B3); the draft/submit wizard endpoints land in B5 alongside it.

// Uploads go client → backend → object storage, never client → bucket. Multer
// holds the file in memory (≤10MB) so the service can magic-byte sniff it
// before anything is stored.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1 },
});

// Keeps the bucket from becoming someone's free file host.
const uploadLimiter = generateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: "Too many document uploads; please try again later",
});

const handleMulterErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Documents must be 10MB or smaller"
        : "Invalid upload";
    return res.status(400).json({ success: false, message });
  }
  next(err);
};

router.post(
  "/:id/documents",
  authenticateCustomer,
  requireActiveCustomer,
  requireCsrfForCookieAuth("customer"),
  uploadLimiter,
  upload.single("file"),
  handleMulterErrors,
  uploadMyDocument
);

router.get("/:id/documents", authenticateCustomer, listMyDocuments);

router.delete(
  "/:id/documents/:docId",
  authenticateCustomer,
  requireActiveCustomer,
  requireCsrfForCookieAuth("customer"),
  removeMyDocument
);

router.get("/:id/documents/:docId/download", authenticateCustomer, downloadMyDocument);

module.exports = router;
