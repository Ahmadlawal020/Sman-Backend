const asyncHandler = require("express-async-handler");
const { pfiExpenseRepo, staffRepo, notificationRepo } = require("../../repositories");
const { client } = require("../../db");
const chain = require("../../lib/expenseChain");
const { notifyExpenseStage } = require("../../services/expenseNotifications.service");
const { deleteFile } = require("../../services/upload.service");

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
  // Outside the oversight roles you see only what you raised. Applied here so
  // every count, total, page and the bank list all inherit it.
  const oversight = chain.canOversee(req.user);

  const result = await pfiExpenseRepo.listExpenses({
    search: req.query.search,
    categoryId: req.query.category,
    pfiId: req.query.pfi,
    bank: req.query.bank,
    type: req.query.type,
    status: req.query.status,
    month: req.query.month,
    dateFrom: parseDate(req.query.dateFrom),
    dateTo: parseDate(req.query.dateTo),
    page: req.query.page,
    limit: req.query.limit,
    onlySubmitterId: oversight ? null : req.user?.id ?? -1,
  });

  res.json({
    success: true,
    data: {
      ...result,
      expenses: decorate(result.expenses, req.user),
      // Tells the page whose entries are on screen, rather than leaving someone
      // wondering why a colleague's row is missing.
      scope: oversight ? "all" : "own",
      can_review: oversight,
      statuses: Object.entries(chain.STATUS_LABELS).map(([value, label]) => ({ value, label })),
    },
  });
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
    receipt_reference: req.body.receipt_reference ?? req.body.receiptReference ?? "",
    payee_bank_name: req.body.payee_bank_name ?? req.body.payeeBankName ?? "",
    payee_account_number: req.body.payee_account_number ?? req.body.payeeAccountNumber ?? "",
    payee_account_name: req.body.payee_account_name ?? req.body.payeeAccountName ?? "",
    // A new request always enters at the start of the chain.
    status: chain.STATUS.PENDING,
    entered_by: actorName,
    recorded_by: actorId,
    added_by: actorId,
  });

  await pfiExpenseRepo.writeAudit({
    expenseId: expense.id,
    action: "created",
    changes: expense,
    actorId,
    actorName,
  });

  notifyExpenseStage({
    expense, stage: chain.STATUS.PENDING, note: "", actorId, actorName,
  }).catch(() => {});

  res.status(201).json({
    success: true,
    message: "Payment request raised",
    data: { expense: decorate([expense], req.user)[0] },
  });
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

  const { actorId, actorName } = await actorFor(req);
  data.edited_by = actorId;

  // Correcting a rejected or sent-back request resubmits it. Without this the
  // entry either sits in a dead state forever, or — worse — a corrected amount
  // slides back into cost without anyone signing it off a second time.
  const resubmitting =
    existing.status === chain.STATUS.REJECTED ||
    existing.status === chain.STATUS.CHANGES_REQUESTED;
  if (resubmitting) {
    data.status = chain.STATUS.PENDING;
    data.review_note = "";
    data.reviewed_by = null;
    data.reviewed_at = null;
  }

  const updated = await pfiExpenseRepo.updateExpense(existing.id, data);

  // Only these fields are worth a diff; the rest is noise in the trail.
  const TRACKED = [
    "expense_date", "category_id", "vendor", "description",
    "amount", "bank_paid_from", "receipt_reference",
  ];
  const diff = {};
  for (const f of TRACKED) {
    if (data[f] !== undefined && String(existing[f] ?? "") !== String(updated[f] ?? "")) {
      diff[f] = [existing[f], updated[f]];
    }
  }

  await pfiExpenseRepo.writeAudit({
    expenseId: existing.id,
    action: "updated",
    changes: diff,
    actorId,
    actorName,
  });

  if (resubmitting) {
    await pfiExpenseRepo.writeAudit({
      expenseId: existing.id,
      action: "submitted",
      changes: { status: [existing.status, chain.STATUS.PENDING], note: "Corrected and resubmitted" },
      actorId,
      actorName,
    });
    notifyExpenseStage({
      expense: updated, stage: chain.STATUS.PENDING, note: "Corrected and resubmitted", actorId, actorName,
    }).catch(() => {});
  }

  res.json({
    success: true,
    message: resubmitting ? "Corrected and resubmitted for verification" : "Expense updated",
    data: { expense: decorate([updated], req.user)[0] },
  });
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



// ─── The approval chain ──────────────────────────────────────────────────────

/** Decorate rows with what this viewer may do, and why not when they can't. */
const decorate = (rows, user) =>
  rows.map((e) => {
    const { actions, reason } = chain.availableActions(
      { status: e.status, addedBy: e.added_by, recordedBy: e.recorded_by },
      user,
    );
    return {
      ...e,
      status_label: chain.STATUS_LABELS[e.status] || e.status,
      status_step: chain.STATUS_STEP[e.status] ?? 0,
      total_steps: chain.TOTAL_STEPS,
      available_actions: actions,
      action_blocked_reason: reason,
    };
  });

const getExpense = asyncHandler(async (req, res) => {
  const expense = await pfiExpenseRepo.findExpenseFull(req.params.id);
  if (!expense || expense.deleted_at) throw httpErr(404, "Expense not found");
  res.json({ success: true, data: { expense: decorate([expense], req.user)[0] } });
});

/**
 * The single path by which status moves. It is read-only on every other
 * endpoint — one writer, or the audit trail is fiction.
 */
const reviewExpense = asyncHandler(async (req, res) => {
  const action = String(req.body.action || "");
  const note = String(req.body.note || "");

  const existing = await pfiExpenseRepo.findExpenseById(req.params.id);
  if (!existing || existing.deleted_at) throw httpErr(404, "Expense not found");

  const check = chain.checkTransition(
    { status: existing.status, addedBy: existing.added_by, recordedBy: existing.recorded_by },
    action,
    req.user,
    note,
  );
  if (!check.ok) {
    return res.status(check.status).json({
      success: false,
      message: check.message,
      ...(check.currentStatus ? { current_status: check.currentStatus } : {}),
    });
  }

  const { actorId, actorName } = await actorFor(req);
  const to = check.transition.to;
  const stamp = chain.STAGE_STAMPS[to];
  const now = new Date().toISOString();

  // Status, stamps and the audit row are one unit: a transition that is not
  // recorded may as well not have happened.
  const updated = await client.begin(async (tx) => {
    const set = {
      status: to,
      reviewed_by: actorId,
      reviewed_at: now,
      review_note: note || "",
      updated_at: now,
    };
    if (stamp) {
      const [byCol, atCol] = stamp;
      const snake = (c) => c.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
      set[snake(byCol)] = actorId;
      set[snake(atCol)] = now;
    }
    const [row] = await tx`UPDATE pfi_expenses SET ${tx(set)} WHERE id = ${existing.id} RETURNING *`;
    await tx`
      INSERT INTO pfi_expense_audits (expense_id, action, changes, actor_id, actor_name)
      VALUES (${existing.id}, ${to}, ${JSON.stringify({ status: [existing.status, to], note })},
              ${actorId}, ${actorName})
    `;
    return row;
  });

  // After the transaction, and never allowed to undo it: a message that fails
  // to send must not roll back an approval that already happened.
  notifyExpenseStage({ expense: updated, stage: to, note, actorId, actorName }).catch(() => {});

  const full = await pfiExpenseRepo.findExpenseFull(updated.id);
  res.json({
    success: true,
    message: `Expense ${chain.STATUS_LABELS[to].toLowerCase()}`,
    data: { expense: decorate([full], req.user)[0] },
  });
});

// ─── Attachments ─────────────────────────────────────────────────────────────
//
// Files go straight from the browser to Cloudinary with a signed upload — the
// app never proxies the bytes. These endpoints only record and remove the
// metadata, so a receipt lives behind Cloudinary's URL rather than a public
// MEDIA_URL path that 404s in production.

const listAttachments = asyncHandler(async (req, res) => {
  const rows = await client`
    SELECT a.*, s.first_name || ' ' || s.surname AS uploaded_by_name
    FROM pfi_expense_attachments a
    LEFT JOIN staff s ON s.id = a.uploaded_by
    WHERE a.expense_id = ${Number(req.params.id)}
    ORDER BY a.uploaded_at
  `;
  res.json({ success: true, data: { attachments: rows } });
});

const addAttachments = asyncHandler(async (req, res) => {
  const expense = await pfiExpenseRepo.findExpenseById(req.params.id);
  if (!expense || expense.deleted_at) throw httpErr(404, "Expense not found");

  // Accepts one or many; the client uploads first, then registers here.
  const incoming = Array.isArray(req.body.files) ? req.body.files : [req.body].filter((f) => f?.url);
  if (incoming.length === 0) throw httpErr(400, "No files supplied");

  const { actorId } = await actorFor(req);
  const rows = [];
  for (const f of incoming) {
    const [row] = await client`
      INSERT INTO pfi_expense_attachments
        (expense_id, storage_key, file_name, content_type, size_bytes, uploaded_by)
      VALUES (${expense.id}, ${f.url || f.secure_url || f.storageKey},
              ${f.fileName || f.original_filename || ""},
              ${f.contentType || f.resource_type || ""},
              ${Number(f.sizeBytes || f.bytes || 0)}, ${actorId})
      RETURNING *
    `;
    rows.push(row);
  }
  res.status(201).json({
    success: true,
    message: `${rows.length} file${rows.length === 1 ? "" : "s"} attached`,
    data: { attachments: rows },
  });
});

const deleteAttachment = asyncHandler(async (req, res) => {
  const [row] = await client`
    DELETE FROM pfi_expense_attachments WHERE id = ${Number(req.params.id)} RETURNING *
  `;
  if (!row) throw httpErr(404, "Attachment not found");

  // Drop the blob too — removing only the row orphans the file in storage.
  // Best-effort: the row is already gone and a failed cleanup must not 500.
  const publicId = row.public_id || row.storage_key;
  if (publicId) deleteFile(publicId).catch(() => {});

  res.json({ success: true, message: "Attachment removed" });
});

module.exports = {
  listAttachments,
  addAttachments,
  deleteAttachment,
  getExpense,
  reviewExpense,
  decorate,
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
