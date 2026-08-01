const express = require("express");
const multer = require("multer");
const router = express.Router();
const { authenticateCustomer, requireActiveCustomer } = require("../../middleware/verifyCustomer");
const { requireCsrfForCookieAuth } = require("../../middleware/csrf");
const generateLimiter = require("../../middleware/generateLimiter");
const validate = require("../../middleware/validate");
const schemas = require("../../schemas/customerLicense.schema");
const { LICENSE_MAX_BYTES } = require("../../services/customerLicense.service");
const {
  listMine,
  reusableForCompany,
  uploadSignature,
  createMine,
  removeMine,
  downloadMine,
} = require("../../controllers/portal/customerLicense.controller");

// A customer's own license register: /api/customer/licenses
const mutate = [authenticateCustomer, requireActiveCustomer, requireCsrfForCookieAuth("customer")];

// Backend-upload mode holds the file in memory (≤10MB) so the service can
// magic-byte sniff it; direct mode ignores the body file.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LICENSE_MAX_BYTES, files: 1 } });
const uploadLimiter = generateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: "Too many license uploads; please try again later",
});
const handleMulterErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "Documents must be 10MB or smaller" : "Invalid upload";
    return res.status(400).json({ success: false, message });
  }
  next(err);
};

router.get("/", authenticateCustomer, listMine);
router.get("/reusable", authenticateCustomer, validate({ query: schemas.reusableQuery }), reusableForCompany);
router.post("/upload-signature", ...mutate, uploadLimiter, uploadSignature);
router.post(
  "/",
  ...mutate,
  uploadLimiter,
  upload.single("file"),
  handleMulterErrors,
  validate({ body: schemas.createLicense }),
  createMine
);
router.delete("/:id", ...mutate, removeMine);
router.get("/:id/download", authenticateCustomer, downloadMine);

module.exports = router;
