const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
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
} = require("../../controllers/administration/expense.controller");

// --- categories -----------------------------------------------------------
// Before the "/:id" expense routes so "categories" is not read as an id.
router.get("/categories", verifyStaff, listCategories);
router.post("/categories", verifyStaff, validate({ body: misc.createCategory }), createCategory);
router.post("/categories/auto-populate", verifyStaff, autoPopulateCategories);
router.patch("/categories/:id", verifyStaff, validate({ params: misc.idParam }), updateCategory);
router.delete("/categories/:id", verifyStaff, validate({ params: misc.idParam }), deleteCategory);

// --- expenses -------------------------------------------------------------
router.get("/", verifyStaff, listExpenses);
router.post("/", verifyStaff, validate({ body: misc.createExpense }), createExpense);
router.patch("/:id", verifyStaff, validate({ params: misc.idParam }), updateExpense);
router.delete("/:id", verifyStaff, validate({ params: misc.idParam }), deleteExpense);

module.exports = router;
