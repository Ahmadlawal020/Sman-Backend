const asyncHandler = require("express-async-handler");
const { pfiExpenseRepo, staffRepo } = require("../../repositories");

function httpErr(status, message) {
  return Object.assign(new Error(message), { status });
}

const parseDate = (val) => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

/** Display name for the audit trail; the FK is what actually identifies them. */
const actorFor = async (req) => {
  const id = req.user?.id ?? null;
  if (!id) return { actorId: null, actorName: "" };
  try {
    const s = await staffRepo.findById(id);
    const name = s ? `${s.firstName || ""} ${s.surname || ""}`.trim() : "";
    return { actorId: id, actorName: name || req.user?.email || "" };
  } catch {
    return { actorId: id, actorName: req.user?.email || "" };
  }
};

/**
 * The whole PFI linkage, in one function.
 *
 * An expense never names a PFI. It names a category, and the category is what
 * carries the link — so this mirrors the category's PFI onto the expense on
 * every write. Move a line to a general category and its PFI clears itself;
 * move it onto a PFI category and it is stamped. Either way the affected PFI
 * totals move on the next read, because nothing is cached.
 *
 * `pfi_id` is deliberately never read from the request body. Accepting it
 * would let a caller book a line against one PFI while it displays under
 * another.
 */
const applyCategoryPfi = async (categoryId) => {
  const category = await pfiExpenseRepo.findCategoryById(categoryId);
  if (!category) throw httpErr(400, "Category not found");
  return { category, pfiId: category.pfi_id || null };
};

// ─── Categories ─────────────────────────────────────────────────────────────

const listCategories = asyncHandler(async (req, res) => {
  const rows = await pfiExpenseRepo.listCategories();

  // Split for the grouped picker: general categories, then PFIs.
  const general = rows.filter((r) => !r.pfi_id);
  const pfi = rows.filter((r) => r.pfi_id);

  res.json({
    success: true,
    data: { categories: rows, general, pfi },
  });
});

const createCategory = asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) throw httpErr(400, "Category name is required");

  const existing = (await pfiExpenseRepo.listCategories()).find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) throw httpErr(409, "A category with this name already exists");

  const category = await pfiExpenseRepo.createCategory(name);
  res.status(201).json({ success: true, message: "Category created", data: { category } });
});

const updateCategory = asyncHandler(async (req, res) => {
  const category = await pfiExpenseRepo.findCategoryById(req.params.id);
  if (!category) throw httpErr(404, "Category not found");
  // A PFI-backed category takes its name from the PFI. Renaming it here would
  // put the two out of step on the next PFI edit.
  if (category.is_system_category) {
    throw httpErr(400, "This category belongs to a PFI — rename the PFI instead");
  }

  const name = String(req.body.name || "").trim();
  if (!name) throw httpErr(400, "Category name is required");

  const updated = await pfiExpenseRepo.updateCategory(category.id, name);
  res.json({ success: true, message: "Category updated", data: { category: updated } });
});

const deleteCategory = asyncHandler(async (req, res) => {
  const category = await pfiExpenseRepo.findCategoryById(req.params.id);
  if (!category) throw httpErr(404, "Category not found");
  if (category.is_system_category) {
    throw httpErr(400, "This category belongs to a PFI and cannot be deleted");
  }

  const inUse = await pfiExpenseRepo.countExpensesInCategory(category.id);
  if (inUse > 0) {
    throw httpErr(400, `Cannot delete: ${inUse} expense line(s) still use this category`);
  }

  await pfiExpenseRepo.deleteCategory(category.id);
  res.json({ success: true, message: "Category deleted" });
});

/** Repair pass for PFIs that predate the category table. */
const autoPopulateCategories = asyncHandler(async (req, res) => {
  const created = await pfiExpenseRepo.autoPopulateCategories();
  res.json({
    success: true,
    message: created.length
      ? `Created ${created.length} missing PFI categor${created.length === 1 ? "y" : "ies"}`
      : "Every PFI already has a category",
    data: { created },
  });
});

// ─── Expenses ───────────────────────────────────────────────────────────────

const listExpenses = asyncHandler(async (req, res) => {
  const result = await pfiExpenseRepo.listExpenses({
    search: req.query.search,
    categoryId: req.query.category,
    pfiId: req.query.pfi,
    bank: req.query.bank,
    type: req.query.type,
    dateFrom: parseDate(req.query.dateFrom),
    dateTo: parseDate(req.query.dateTo),
    page: req.query.page,
    limit: req.query.limit,
  });

  res.json({ success: true, data: result });
});

const createExpense = asyncHandler(async (req, res) => {
  const categoryId = req.body.category_id ?? req.body.categoryId ?? req.body.category;
  if (!categoryId) throw httpErr(400, "Category is required");

  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 0) throw httpErr(400, "Amount must be a positive number");

  const { pfiId } = await applyCategoryPfi(categoryId);
  const { actorId, actorName } = await actorFor(req);

  const expense = await pfiExpenseRepo.createExpense({
    pfi_id: pfiId,
    category_id: Number(categoryId),
    expense_date: parseDate(req.body.expense_date ?? req.body.expenseDate) || new Date().toISOString(),
    vendor: req.body.vendor || "",
    description: req.body.description || "",
    amount: String(amount),
    bank_paid_from: req.body.bank_paid_from ?? req.body.bankPaidFrom ?? "",
    entered_by: actorName,
    recorded_by: actorId,
  });

  await pfiExpenseRepo.writeAudit({
    expenseId: expense.id,
    action: "create",
    changes: expense,
    actorId,
    actorName,
  });

  res.status(201).json({ success: true, message: "Expense recorded", data: { expense } });
});

const updateExpense = asyncHandler(async (req, res) => {
  const existing = await pfiExpenseRepo.findExpenseById(req.params.id);
  if (!existing) throw httpErr(404, "Expense not found");
  if (existing.deleted_at) throw httpErr(400, "This expense has been deleted");

  const data = {};

  // Changing the category re-points the PFI link — that is the whole mechanism.
  const categoryId = req.body.category_id ?? req.body.categoryId ?? req.body.category;
  if (categoryId !== undefined) {
    const { pfiId } = await applyCategoryPfi(categoryId);
    data.category_id = Number(categoryId);
    data.pfi_id = pfiId;
  }

  if (req.body.amount !== undefined) {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw httpErr(400, "Amount must be a positive number");
    }
    data.amount = String(amount);
  }

  const date = req.body.expense_date ?? req.body.expenseDate;
  if (date !== undefined) data.expense_date = parseDate(date);
  if (req.body.vendor !== undefined) data.vendor = req.body.vendor;
  if (req.body.description !== undefined) data.description = req.body.description;
  const bank = req.body.bank_paid_from ?? req.body.bankPaidFrom;
  if (bank !== undefined) data.bank_paid_from = bank;

  if (Object.keys(data).length === 0) {
    return res.json({ success: true, message: "Nothing to update", data: { expense: existing } });
  }

  const updated = await pfiExpenseRepo.updateExpense(existing.id, data);
  const { actorId, actorName } = await actorFor(req);

  await pfiExpenseRepo.writeAudit({
    expenseId: existing.id,
    action: "update",
    changes: { before: existing, after: updated },
    actorId,
    actorName,
  });

  res.json({ success: true, message: "Expense updated", data: { expense: updated } });
});

const deleteExpense = asyncHandler(async (req, res) => {
  const existing = await pfiExpenseRepo.findExpenseById(req.params.id);
  if (!existing) throw httpErr(404, "Expense not found");
  if (existing.deleted_at) {
    return res.json({ success: true, message: "Expense already deleted" });
  }

  const deleted = await pfiExpenseRepo.softDeleteExpense(existing.id);
  const { actorId, actorName } = await actorFor(req);

  await pfiExpenseRepo.writeAudit({
    expenseId: existing.id,
    action: "delete",
    changes: existing,
    actorId,
    actorName,
  });

  res.json({ success: true, message: "Expense deleted", data: { expense: deleted } });
});

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  autoPopulateCategories,
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  // Shared with the PFI controller's quick-add.
  applyCategoryPfi,
  actorFor,
};
