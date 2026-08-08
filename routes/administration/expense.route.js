const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const { authenticateStaff } = require("../../middleware/verifyStaff");
const { requireExpenseRole } = require("../../middleware/expenseAccess");
const validate = require("../../middleware/validate");
const misc = require("../../schemas/misc.schema");
const {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  autoPopulateCategories,
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  getExpense,
  reviewExpense,
  listAttachments,
  addAttachments,
  deleteAttachment,
} = require("../../controllers/administration/expense.controller");

// --- categories -----------------------------------------------------------
// Before the "/:id" expense routes so "categories" is not read as an id.
router.get("/categories", authenticateStaff, listCategories);
router.post("/categories", verifyStaff, validate({ body: misc.createCategory }), createCategory);
router.post("/categories/auto-populate", verifyStaff, autoPopulateCategories);
router.patch("/categories/:id", verifyStaff, validate({ params: misc.idParam }), updateCategory);
router.delete("/categories/:id", verifyStaff, validate({ params: misc.idParam }), deleteCategory);

// --- expenses -------------------------------------------------------------
router.get("/", authenticateStaff, listExpenses);
router.get("/:id", authenticateStaff, validate({ params: misc.idParam }), getExpense);
// The only path by which status moves.
router.get("/:id/attachments", authenticateStaff, validate({ params: misc.idParam }), listAttachments);
router.post("/:id/attachments", authenticateStaff, validate({ params: misc.idParam }), addAttachments);
router.delete("/attachments/:id", authenticateStaff, validate({ params: misc.idParam }), deleteAttachment);
router.post("/:id/review", authenticateStaff, requireExpenseRole, validate({ params: misc.idParam }), reviewExpense);
router.post("/", authenticateStaff, validate({ body: misc.createExpense }), createExpense);
router.patch("/:id", authenticateStaff, validate({ params: misc.idParam }), updateExpense);
router.delete("/:id", authenticateStaff, validate({ params: misc.idParam }), deleteExpense);

module.exports = router;
