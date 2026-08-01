const express = require("express");
const multer = require("multer");
const router = express.Router();
const { authenticateCustomer, requireActiveCustomer } = require("../../middleware/verifyCustomer");
const { requireCsrfForCookieAuth } = require("../../middleware/csrf");
const generateLimiter = require("../../middleware/generateLimiter");
const validate = require("../../middleware/validate");
const schemas = require("../../schemas/dangoteDelivery.schema");
const { DOCUMENT_MAX_BYTES } = require("../../services/dangoteDelivery/documents");
const {
  uploadMyDocument,
  listMyDocuments,
  removeMyDocument,
  downloadMyDocument,
  createMyDraft,
  listMyOrders,
  getMyOrder,
  updateMyDetails,
  setMyCompany,
  findMyReusableCompany,
  reuseMyDocuments,
  submitMyDocuments,
  linkMyLicense,
  getTerms,
  acceptMyTerms,
  submitMyRequest,
  reopenMyOrder,
  cancelMyOrder,
} = require("../../controllers/portal/dangoteDelivery.controller");

// The full customer auth stack for anything that mutates.
const mutate = [
  authenticateCustomer,
  requireActiveCustomer,
  requireCsrfForCookieAuth("customer"),
];

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

// Static paths BEFORE "/:id" so they are never mistaken for order ids.
router.get("/terms", authenticateCustomer, getTerms);
router.get(
  "/reusable-company",
  authenticateCustomer,
  validate({ query: schemas.reusableCompanyQuery }),
  findMyReusableCompany
);

// Wizard lifecycle
router.post("/", ...mutate, validate({ body: schemas.orderDetails }), createMyDraft);
router.get("/", authenticateCustomer, listMyOrders);
router.get("/:id", authenticateCustomer, getMyOrder);
router.patch("/:id", ...mutate, validate({ body: schemas.orderDetails }), updateMyDetails);
router.put("/:id/company", ...mutate, validate({ body: schemas.companyInfo }), setMyCompany);
router.post(
  "/:id/license",
  ...mutate,
  validate({ body: require("../../schemas/customerLicense.schema").linkLicense }),
  linkMyLicense
);
router.post("/:id/documents/submit", ...mutate, submitMyDocuments);
router.post("/:id/agreement", ...mutate, validate({ body: schemas.acceptTerms }), acceptMyTerms);
router.post("/:id/submit", ...mutate, submitMyRequest);
router.post("/:id/reopen", ...mutate, reopenMyOrder);
router.post("/:id/cancel", ...mutate, cancelMyOrder);

// Documents
router.post(
  "/:id/documents",
  ...mutate,
  uploadLimiter,
  upload.single("file"),
  handleMulterErrors,
  uploadMyDocument
);

router.get("/:id/documents", authenticateCustomer, listMyDocuments);

router.post(
  "/:id/documents/reuse",
  ...mutate,
  validate({ body: schemas.reuseDocuments }),
  reuseMyDocuments
);

router.delete("/:id/documents/:docId", ...mutate, removeMyDocument);

router.get("/:id/documents/:docId/download", authenticateCustomer, downloadMyDocument);

module.exports = router;
