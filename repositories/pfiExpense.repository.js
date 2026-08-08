const { client } = require("../db");
const { REVENUE_STATUSES } = require("../lib/pfiFinance");
const { OPEN_STATES } = require("../lib/expenseChain");

/**
 * Aggregates for many PFIs at once.
 *
 * The obvious shape here is one set of queries per PFI, which costs a dozen
 * round trips each and makes a 34-PFI list take seconds. These are three
 * grouped queries for the whole page instead, so the cost is flat in the
 * number of PFIs.
 *
 * @param {number[]} ids
 * @returns {Promise<Map<number, {expenses,revenue,movementQty,orderCount,expenseCount}>>}
 */
const aggregatesFor = async (ids) => {
  const out = new Map();
  const list = [...new Set((ids || []).map(Number).filter(Number.isFinite))];
  if (list.length === 0) return out;

  const blank = () => ({
    expenses: 0,
    pendingExpenses: 0,
    pendingExpenseCount: 0,
    revenue: 0,
    movementQty: 0,
    allocationQty: 0,
    orderCount: 0,
    expenseCount: 0,
  });
  for (const id of list) out.set(id, blank());

  const [expenses, revenue, movements, allocations] = await Promise.all([
    // Soft-deleted lines are excluded from every total.
    //
    // `total` is PAID ONLY — that is the entire point of the approval chain.
    // A request that has not been paid must never move a cargo's cost, profit
    // or landing price. `open` is the committed-but-not-yet-out figure, which
    // the UI shows beside the cost and never inside it.
    client`
      SELECT pfi_id,
             COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::text AS total,
             COUNT(*) FILTER (WHERE status = 'paid')::int AS lines,
             COALESCE(SUM(amount) FILTER (WHERE status = ANY(${OPEN_STATES})), 0)::text AS open_total,
             COUNT(*) FILTER (WHERE status = ANY(${OPEN_STATES}))::int AS open_lines
      FROM pfi_expenses
      WHERE pfi_id = ANY(${list}) AND deleted_at IS NULL
      GROUP BY pfi_id
    `,
    client`
      SELECT pfi_id, COALESCE(SUM(total_amount), 0)::text AS total, COUNT(*)::int AS orders
      FROM orders
      WHERE pfi_id = ANY(${list}) AND status = ANY(${REVENUE_STATUSES})
      GROUP BY pfi_id
    `,
    // The append-only ledger is the source of truth for released stock.
    client`
      SELECT pfi_id, COALESCE(SUM(qty_litres), 0)::bigint AS qty
      FROM pfi_movements
      WHERE pfi_id = ANY(${list})
      GROUP BY pfi_id
    `,
    // Delivery allocations are a second way stock leaves a batch, and they
    // count toward sold alongside releases — a litre allocated to a delivery
    // is no longer available to sell.
    client`
      SELECT pfi_id, COALESCE(SUM(quantity), 0)::bigint AS qty
      FROM order_pfi_allocations
      WHERE pfi_id = ANY(${list})
      GROUP BY pfi_id
    `,
  ]);

  for (const r of expenses) {
    const row = out.get(Number(r.pfi_id));
    if (row) {
      row.expenses = Number(r.total);
      row.expenseCount = r.lines;
      row.pendingExpenses = Number(r.open_total);
      row.pendingExpenseCount = r.open_lines;
    }
  }
  for (const r of revenue) {
    const row = out.get(Number(r.pfi_id));
    if (row) {
      row.revenue = Number(r.total);
      row.orderCount = r.orders;
    }
  }
  for (const r of movements) {
    const row = out.get(Number(r.pfi_id));
    if (row) row.movementQty = Number(r.qty);
  }
  for (const r of allocations) {
    const row = out.get(Number(r.pfi_id));
    if (row) row.allocationQty = Number(r.qty);
  }

  return out;
};

// ─── Categories ─────────────────────────────────────────────────────────────

/**
 * Every PFI gets a category the moment it is created. This stands in for the
 * Django post_save signal: same guarantee, but it runs inside the caller's
 * transaction so a PFI can never exist without its category.
 */
const ensureCategoryForPfi = async (pfiId, pfiNumber, tx = client) => {
  const [row] = await tx`
    INSERT INTO expense_categories (name, pfi_id, is_system_category)
    VALUES (${pfiNumber}, ${Number(pfiId)}, true)
    ON CONFLICT (pfi_id) WHERE pfi_id IS NOT NULL
      DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
    RETURNING *
  `;
  return row;
};

/** Renaming a PFI renames its category, so the two never drift apart. */
const renameCategoryForPfi = async (pfiId, pfiNumber, tx = client) => {
  const [row] = await tx`
    UPDATE expense_categories
    SET name = ${pfiNumber}, updated_at = NOW()
    WHERE pfi_id = ${Number(pfiId)}
    RETURNING *
  `;
  return row || null;
};

const findCategoryById = async (id) => {
  const [row] = await client`SELECT * FROM expense_categories WHERE id = ${Number(id)}`;
  return row || null;
};

const listCategories = async () => {
  // PFI-backed categories carry their PFI's status so the picker can show
  // which batches are still open.
  return client`
    SELECT c.*, p.status AS pfi_status, p.pfi_number
    FROM expense_categories c
    LEFT JOIN pfis p ON p.id = c.pfi_id
    ORDER BY c.is_system_category ASC, c.name ASC
  `;
};

const createCategory = async (name) => {
  const [row] = await client`
    INSERT INTO expense_categories (name, pfi_id, is_system_category)
    VALUES (${name}, NULL, false)
    RETURNING *
  `;
  return row;
};

const updateCategory = async (id, name) => {
  const [row] = await client`
    UPDATE expense_categories SET name = ${name}, updated_at = NOW()
    WHERE id = ${Number(id)} RETURNING *
  `;
  return row || null;
};

const deleteCategory = async (id) => {
  const [row] = await client`DELETE FROM expense_categories WHERE id = ${Number(id)} RETURNING id`;
  return !!row;
};

const countExpensesInCategory = async (id) => {
  const [row] = await client`
    SELECT COUNT(*)::int AS n FROM pfi_expenses
    WHERE category_id = ${Number(id)} AND deleted_at IS NULL
  `;
  return row.n;
};

/**
 * Repair pass: create categories for any PFI missing one. Needed because rows
 * predating this table have no category, and without one their expenses can
 * never be booked.
 */
const autoPopulateCategories = async () => {
  const rows = await client`
    INSERT INTO expense_categories (name, pfi_id, is_system_category)
    SELECT p.pfi_number, p.id, true
    FROM pfis p
    LEFT JOIN expense_categories c ON c.pfi_id = p.id
    WHERE c.id IS NULL
    ON CONFLICT DO NOTHING
    RETURNING id, name
  `;
  return rows;
};

// ─── Expenses ───────────────────────────────────────────────────────────────

const findExpenseById = async (id) => {
  const [row] = await client`
    SELECT e.*, c.name AS category_name, c.is_system_category, p.pfi_number
    FROM pfi_expenses e
    JOIN expense_categories c ON c.id = e.category_id
    LEFT JOIN pfis p ON p.id = e.pfi_id
    WHERE e.id = ${Number(id)}
  `;
  return row || null;
};

const listExpensesForPfi = async (pfiId) => {
  return client`
    SELECT e.*, c.name AS category_name
    FROM pfi_expenses e
    JOIN expense_categories c ON c.id = e.category_id
    WHERE e.pfi_id = ${Number(pfiId)} AND e.deleted_at IS NULL
    ORDER BY e.expense_date DESC, e.id DESC
  `;
};

/**
 * The expenses page: filterable list plus the totals it shows in its cards.
 * Both come off the same WHERE so the cards can never disagree with the rows.
 */
const listExpenses = async ({
  search,
  categoryId,
  pfiId,
  bank,
  type,
  status,
  dateFrom,
  dateTo,
  month,
  page = 1,
  limit = 25,
  /** Null means oversight — see everything. A number scopes to one submitter. */
  onlySubmitterId = null,
} = {}) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 25));
  const offset = (pageNum - 1) * limitNum;

  // Scoping goes on first so every count, total, page and the bank list all
  // inherit it. Without that the bank dropdown leaks which accounts colleagues
  // pay from even when their rows are hidden.
  const base = [client`e.deleted_at IS NULL`];
  if (onlySubmitterId != null) {
    base.push(client`COALESCE(e.added_by, e.recorded_by) = ${Number(onlySubmitterId)}`);
  }

  if (search) {
    const p = `%${search}%`;
    base.push(
      client`(e.description ILIKE ${p} OR e.vendor ILIKE ${p} OR c.name ILIKE ${p}
              OR e.bank_paid_from ILIKE ${p} OR e.receipt_reference ILIKE ${p})`
    );
  }
  if (categoryId === "none") base.push(client`e.category_id IS NULL`);
  else if (categoryId && categoryId !== "all") base.push(client`e.category_id = ${Number(categoryId)}`);
  if (pfiId && pfiId !== "all") base.push(client`e.pfi_id = ${Number(pfiId)}`);
  if (bank) base.push(client`LOWER(e.bank_paid_from) = LOWER(${bank})`);
  if (type === "pfi") base.push(client`e.pfi_id IS NOT NULL`);
  if (type === "general") base.push(client`e.pfi_id IS NULL`);
  if (dateFrom) base.push(client`e.expense_date >= ${dateFrom}`);
  if (dateTo) base.push(client`e.expense_date <= ${dateTo}`);
  // A malformed month is ignored rather than erroring — it arrives from a URL.
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    base.push(client`to_char(e.expense_date, 'YYYY-MM') = ${month}`);
  }

  const join = (parts) => parts.reduce((a, c, i) => (i === 0 ? c : client`${a} AND ${c}`));
  const baseClause = join(base);

  // The status filter is applied to rows and totals, but deliberately NOT to
  // the tab counts — otherwise every other tab reads zero once you are inside
  // one, which is the single most-reported "the numbers are wrong" bug.
  const withStatus = [...base];
  if (status === "awaiting") withStatus.push(client`e.status = ANY(${OPEN_STATES})`);
  else if (status && status !== "all") withStatus.push(client`e.status = ${status}`);
  const rowClause = join(withStatus);

  const [rows, [totals], [counts], banks] = await Promise.all([
    client`
      SELECT e.*, c.name AS category_name, c.is_system_category, p.pfi_number,
             sub.first_name || ' ' || sub.surname AS submitted_by_name,
             rev.first_name || ' ' || rev.surname AS reviewed_by_name,
             (SELECT COUNT(*)::int FROM pfi_expense_attachments a WHERE a.expense_id = e.id)
               AS attachment_count
      FROM pfi_expenses e
      JOIN expense_categories c ON c.id = e.category_id
      LEFT JOIN pfis p ON p.id = e.pfi_id
      LEFT JOIN staff sub ON sub.id = COALESCE(e.added_by, e.recorded_by)
      LEFT JOIN staff rev ON rev.id = e.reviewed_by
      WHERE ${rowClause}
      ORDER BY e.expense_date DESC, e.id DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `,
    // Totals cover the whole filtered set, never just the page, so the summary
    // can never disagree with the filter above it.
    client`
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(e.amount), 0)::text AS total,
        COALESCE(SUM(e.amount) FILTER (WHERE e.pfi_id IS NOT NULL), 0)::text AS pfi_total,
        COALESCE(SUM(e.amount) FILTER (WHERE e.pfi_id IS NULL), 0)::text AS general_total,
        COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'paid'), 0)::text AS paid_total,
        COALESCE(SUM(e.amount) FILTER (WHERE e.status = ANY(${OPEN_STATES})), 0)::text AS open_total
      FROM pfi_expenses e
      JOIN expense_categories c ON c.id = e.category_id
      LEFT JOIN pfis p ON p.id = e.pfi_id
      WHERE ${rowClause}
    `,
    client`
      SELECT
        COUNT(*)::int AS all,
        COUNT(*) FILTER (WHERE e.status = ANY(${OPEN_STATES}))::int AS awaiting,
        COUNT(*) FILTER (WHERE e.status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE e.status = 'verified')::int AS verified,
        COUNT(*) FILTER (WHERE e.status = 'audit_approved')::int AS audit_approved,
        COUNT(*) FILTER (WHERE e.status = 'admin_approved')::int AS admin_approved,
        COUNT(*) FILTER (WHERE e.status = 'paid')::int AS paid,
        COUNT(*) FILTER (WHERE e.status = 'rejected')::int AS rejected,
        COUNT(*) FILTER (WHERE e.status = 'changes_requested')::int AS changes_requested
      FROM pfi_expenses e
      JOIN expense_categories c ON c.id = e.category_id
      WHERE ${baseClause}
    `,
    client`
      SELECT DISTINCT e.bank_paid_from
      FROM pfi_expenses e
      JOIN expense_categories c ON c.id = e.category_id
      WHERE ${baseClause} AND e.bank_paid_from <> ''
      ORDER BY e.bank_paid_from
    `,
  ]);

  return {
    expenses: rows,
    totals: {
      count: totals.count,
      total: Number(totals.total),
      pfiTotal: Number(totals.pfi_total),
      generalTotal: Number(totals.general_total),
      paidTotal: Number(totals.paid_total),
      openTotal: Number(totals.open_total),
    },
    statusCounts: counts,
    banks: banks.map((b) => b.bank_paid_from),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: totals.count,
      totalPages: Math.max(1, Math.ceil(totals.count / limitNum)),
    },
  };
};

/** One expense with everything the detail view needs, in two queries. */
const findExpenseFull = async (id) => {
  const [row] = await client`
    SELECT e.*, c.name AS category_name, c.is_system_category, p.pfi_number,
           sub.first_name || ' ' || sub.surname AS submitted_by_name
    FROM pfi_expenses e
    JOIN expense_categories c ON c.id = e.category_id
    LEFT JOIN pfis p ON p.id = e.pfi_id
    LEFT JOIN staff sub ON sub.id = COALESCE(e.added_by, e.recorded_by)
    WHERE e.id = ${Number(id)}
  `;
  if (!row) return null;

  const [attachments, history] = await Promise.all([
    client`
      SELECT a.*, s.first_name || ' ' || s.surname AS uploaded_by_name
      FROM pfi_expense_attachments a
      LEFT JOIN staff s ON s.id = a.uploaded_by
      WHERE a.expense_id = ${row.id} ORDER BY a.uploaded_at
    `,
    // Reasons are read from the audit table, never from review_note — that
    // column is overwritten on every transition, so a rejection reason would
    // vanish the moment the corrected request was approved.
    client`
      SELECT a.action, a.changes, a.created_at, a.actor_name
      FROM pfi_expense_audits a
      WHERE a.expense_id = ${row.id}
      ORDER BY a.created_at ASC, a.id ASC
    `,
  ]);

  return { ...row, attachments, history };
};

const createExpense = async (data, tx = client) => {
  const [row] = await tx`
    INSERT INTO pfi_expenses ${tx(data)} RETURNING *
  `;
  return row;
};

const updateExpense = async (id, data, tx = client) => {
  const [row] = await tx`
    UPDATE pfi_expenses SET ${tx({ ...data, updated_at: new Date().toISOString() })}
    WHERE id = ${Number(id)} AND deleted_at IS NULL
    RETURNING *
  `;
  return row || null;
};

/** Soft delete — the row stays and drops out of every total. */
const softDeleteExpense = async (id) => {
  const [row] = await client`
    UPDATE pfi_expenses SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = ${Number(id)} AND deleted_at IS NULL
    RETURNING *
  `;
  return row || null;
};

const writeAudit = async ({ expenseId, action, changes, actorId, actorName }, tx = client) => {
  await tx`
    INSERT INTO pfi_expense_audits (expense_id, action, changes, actor_id, actor_name)
    VALUES (${expenseId ?? null}, ${action}, ${JSON.stringify(changes || {})},
            ${actorId ?? null}, ${actorName || ""})
  `;
};

// ─── Movements ──────────────────────────────────────────────────────────────

/**
 * Deduct stock. `ON CONFLICT DO NOTHING` against the unique (order, action)
 * index is what makes this idempotent — re-running ticket generation for an
 * order can never deduct the same PFI twice.
 *
 * @returns the inserted row, or null if this order already moved.
 */
const recordMovement = async (
  { pfiId, orderId, action = "RELEASE", qtyLitres, notes, recordedBy },
  tx = client
) => {
  const [row] = await tx`
    INSERT INTO pfi_movements (pfi_id, order_id, action, qty_litres, notes, recorded_by)
    VALUES (${Number(pfiId)}, ${orderId ?? null}, ${action}, ${Number(qtyLitres)},
            ${notes || ""}, ${recordedBy ?? null})
    ON CONFLICT (order_id, action) DO NOTHING
    RETURNING *
  `;
  return row || null;
};

const listMovements = async (pfiId) => {
  return client`
    SELECT m.*, o.order_number, o.status AS order_status,
           COALESCE(NULLIF(TRIM(c.company_name), ''), c.name) AS customer_name
    FROM pfi_movements m
    LEFT JOIN orders o ON o.id = m.order_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE m.pfi_id = ${Number(pfiId)}
    ORDER BY m.created_at DESC
  `;
};

module.exports = {
  aggregatesFor,
  ensureCategoryForPfi,
  renameCategoryForPfi,
  findCategoryById,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  countExpensesInCategory,
  autoPopulateCategories,
  findExpenseById,
  listExpensesForPfi,
  listExpenses,
  findExpenseFull,
  createExpense,
  updateExpense,
  softDeleteExpense,
  writeAudit,
  recordMovement,
  listMovements,
};
