const { client } = require("../db");
const { REVENUE_STATUSES } = require("../lib/pfiFinance");
const { STATUS_TO_LIVE } = require("../utils/orderStatusMapping");

// REVENUE_STATUSES is Sman vocabulary ("Paid", "Released", …) but
// consumer_order.status stores Django's lowercase set — matching the raw
// list against the live column silently returns zero revenue for every PFI.
const LIVE_REVENUE_STATUSES = [...new Set(REVENUE_STATUSES.map((s) => STATUS_TO_LIVE[s]))];
const { OPEN_STATES } = require("../lib/expenseChain");

/**
 * consumer_pfiexpense is Django's real expense table — every table below was
 * previously queried under old clean-room names (pfi_expenses, orders,
 * staff, pfis, expense_categories, pfi_movements, order_pfi_allocations)
 * that don't exist on the live schema at all (relation does not exist on
 * every call). Corrected mapping, verified against the schema files, not
 * guessed:
 *
 *   pfi_expenses          -> consumer_pfiexpense
 *   expense_categories    -> consumer_expensecategory
 *   pfi_expense_attachments -> consumer_pfiexpenseattachment
 *   pfi_expense_audits    -> consumer_pfiexpenseaudit (changed_fields not
 *                            "changes", performed_at not "created_at",
 *                            performed_by_id not "actor_id"/"actor_name" —
 *                            there is no free-text actor name column at all,
 *                            joined from staff below instead)
 *   pfi_expense_comments  -> sman.pfi_expense_comments (no live Django
 *                            equivalent; this thread was always Sman-only)
 *   pfi_movements         -> consumer_pfimovement
 *   orders                -> consumer_order
 *   customers              -> consumer_customer
 *   pfis                  -> consumer_pfi
 *   staff                  -> administration_user (one fullName column, not
 *                            first_name/surname — this table has never had
 *                            a split name)
 *
 * consumer_pfiexpense has no vendor_id, invoice_number, tin_number, VAT/WHT
 * breakdown, or payment reference/method/date columns, and
 * consumer_expensecategory has no GL chart-of-accounts columns — those live
 * 1:1 keyed in sman.pfi_expense_extras / sman.expense_category_extras
 * (built this session specifically to hold what Django's tables don't),
 * joined in throughout. There is also no amount_paid column anywhere —
 * "paid" spend now reads e.amount directly; the historical amount_paid
 * fallback this file's SPEND constant described never had a live backing.
 *
 * order_pfi_allocations (used only for aggregatesFor's allocationQty) has no
 * live equivalent — a PFI's litres leaving via delivery aren't tracked in a
 * dedicated allocation table on the live schema. Derived instead from
 * consumer_truckallocation joined through consumer_order.pfi_id, which is
 * the real mechanism by which a PFI's stock leaves against an order.
 *
 * Location scoping (which PFIs a non-full-access staffer may see) previously
 * matched a PFI's location_id/lpg_station_id against the caller's scoped
 * depot/LPG-station ids. consumer_pfi only has locationId, which is a STATE
 * (see repositories/depot.repository.js's header comment — same gap), not a
 * depot or LPG station. Rather than guess a state<->depot mapping here too,
 * scoping below falls back to the caller's directly-granted pfiIds only —
 * narrower than before, not wider, so a scoped user never sees more than
 * they should even though they may now see fewer PFIs than the old
 * depot/LPG-implied scope intended. Flagged for a real fix, not invented.
 */

// The figure a total should use — there is no amount_paid column on the live
// schema (see header comment), so this is always the requested/approved amount.
const SPEND = client`e.amount`;

/**
 * Aggregates for many PFIs at once.
 *
 * The obvious shape here is one set of queries per PFI, which costs a dozen
 * round trips each and makes a 34-PFI list take seconds. These are four
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
      SELECT e.pfi_id,
             COALESCE(SUM(${SPEND}) FILTER (WHERE e.status = 'paid'), 0)::text AS total,
             COUNT(*) FILTER (WHERE e.status = 'paid')::int AS lines,
             COALESCE(SUM(e.amount) FILTER (WHERE e.status = ANY(${OPEN_STATES})), 0)::text AS open_total,
             COUNT(*) FILTER (WHERE e.status = ANY(${OPEN_STATES}))::int AS open_lines
      FROM consumer_pfiexpense e
      WHERE e.pfi_id = ANY(${list}) AND e.deleted_at IS NULL
      GROUP BY e.pfi_id
    `,
    client`
      SELECT pfi_id, COALESCE(SUM(total_price), 0)::text AS total, COUNT(*)::int AS orders
      FROM consumer_order
      WHERE pfi_id = ANY(${list}) AND status = ANY(${LIVE_REVENUE_STATUSES})
      GROUP BY pfi_id
    `,
    // The append-only ledger is the source of truth for released stock.
    client`
      SELECT pfi_id, COALESCE(SUM(qty_litres), 0)::bigint AS qty
      FROM consumer_pfimovement
      WHERE pfi_id = ANY(${list})
      GROUP BY pfi_id
    `,
    // Delivery allocations are a second way stock leaves a batch, and they
    // count toward sold alongside releases — a litre allocated to a truck
    // against an order tied to this PFI is no longer available to sell. See
    // this file's header comment: there is no dedicated allocation table on
    // the live schema, so this is derived through the order.
    client`
      SELECT o.pfi_id, COALESCE(SUM(t.quantity), 0)::bigint AS qty
      FROM consumer_truckallocation t
      JOIN consumer_order o ON o.id = t.order_id
      WHERE o.pfi_id = ANY(${list})
      GROUP BY o.pfi_id
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
  const [byPfi] = await tx`SELECT * FROM consumer_expensecategory WHERE pfi_id = ${Number(pfiId)} LIMIT 1`;
  if (byPfi) {
    if (byPfi.name !== pfiNumber) {
      const [updated] = await tx`
        UPDATE consumer_expensecategory
        SET name = ${pfiNumber}, updated_at = NOW()
        WHERE id = ${byPfi.id}
        RETURNING *
      `;
      return updated;
    }
    return byPfi;
  }
  const [byName] = await tx`SELECT * FROM consumer_expensecategory WHERE name = ${pfiNumber} LIMIT 1`;
  if (byName) {
    const [updated] = await tx`
      UPDATE consumer_expensecategory
      SET pfi_id = ${Number(pfiId)}, is_system_category = true, updated_at = NOW()
      WHERE id = ${byName.id}
      RETURNING *
    `;
    return updated;
  }
  const [row] = await tx`
    INSERT INTO consumer_expensecategory (name, pfi_id, is_system_category, description, created_at, updated_at)
    VALUES (${pfiNumber}, ${Number(pfiId)}, true, '', NOW(), NOW())
    RETURNING *
  `;
  return row;
};

/** Renaming a PFI renames its category, so the two never drift apart. */
const renameCategoryForPfi = async (pfiId, pfiNumber, tx = client) => {
  const [row] = await tx`
    UPDATE consumer_expensecategory
    SET name = ${pfiNumber}, updated_at = NOW()
    WHERE pfi_id = ${Number(pfiId)}
    RETURNING *
  `;
  return row || null;
};

const findCategoryById = async (id) => {
  const [row] = await client`
    SELECT c.*, x.gl_code, x.gl_group, x.gl_subgroup
    FROM consumer_expensecategory c
    LEFT JOIN sman.expense_category_extras x ON x.category_id = c.id
    WHERE c.id = ${Number(id)}
  `;
  return row || null;
};

const listCategories = async () => {
  // PFI-backed categories carry their PFI's status so the picker can show
  // which batches are still open.
  //
  // Ordered by GL code, not alphabetically: the code is the order Finance reads
  // the chart in, and it keeps each subgroup's accounts together.
  //
  // The line count comes back with the row so the chart editor can say why an
  // account cannot be deleted, rather than only refusing after the click.
  return client`
    SELECT c.*, x.gl_code, x.gl_group, x.gl_subgroup, p.status AS pfi_status, p.pfi_number,
           (SELECT COUNT(*)::int FROM consumer_pfiexpense e
            WHERE e.category_id = c.id AND e.deleted_at IS NULL) AS expense_count
    FROM consumer_expensecategory c
    LEFT JOIN sman.expense_category_extras x ON x.category_id = c.id
    LEFT JOIN consumer_pfi p ON p.id = c.pfi_id
    ORDER BY c.is_system_category ASC, x.gl_code ASC NULLS LAST, c.name ASC
  `;
};

const createCategory = async (name, { glCode = null, glGroup = null, glSubgroup = "" } = {}) => {
  const [row] = await client`
    INSERT INTO consumer_expensecategory (name, pfi_id, is_system_category, description, created_at, updated_at)
    VALUES (${name}, NULL, false, '', NOW(), NOW())
    RETURNING *
  `;
  if (glCode || glGroup || glSubgroup) {
    await client`
      INSERT INTO sman.expense_category_extras (category_id, gl_code, gl_group, gl_subgroup)
      VALUES (${row.id}, ${glCode || null}, ${glGroup || null}, ${glSubgroup || ""})
    `;
  }
  return findCategoryById(row.id);
};

/** Takes a name alone in the common case, or a patch of columns to set. */
const updateCategory = async (id, data) => {
  const patch = typeof data === "string" ? { name: data } : { ...(data || {}) };
  const { gl_code, gl_group, gl_subgroup, glCode, glGroup, glSubgroup, ...corePatch } = patch;
  const numId = Number(id);

  if (Object.keys(corePatch).length > 0) {
    await client`
      UPDATE consumer_expensecategory
      SET ${client({ ...corePatch, updated_at: new Date().toISOString() })}
      WHERE id = ${numId}
    `;
  }

  const extras = {
    gl_code: gl_code ?? glCode,
    gl_group: gl_group ?? glGroup,
    gl_subgroup: gl_subgroup ?? glSubgroup,
  };
  const hasExtras = Object.values(extras).some((v) => v !== undefined);
  if (hasExtras) {
    await client`
      INSERT INTO sman.expense_category_extras (category_id, gl_code, gl_group, gl_subgroup)
      VALUES (${numId}, ${extras.gl_code ?? null}, ${extras.gl_group ?? null}, ${extras.gl_subgroup ?? ""})
      ON CONFLICT (category_id) DO UPDATE SET
        gl_code = COALESCE(EXCLUDED.gl_code, sman.expense_category_extras.gl_code),
        gl_group = COALESCE(EXCLUDED.gl_group, sman.expense_category_extras.gl_group),
        gl_subgroup = COALESCE(EXCLUDED.gl_subgroup, sman.expense_category_extras.gl_subgroup),
        updated_at = NOW()
    `;
  }

  return findCategoryById(numId);
};

const deleteCategory = async (id) => {
  const [row] = await client`DELETE FROM consumer_expensecategory WHERE id = ${Number(id)} RETURNING id`;
  return !!row;
};

const countExpensesInCategory = async (id) => {
  const [row] = await client`
    SELECT COUNT(*)::int AS n FROM consumer_pfiexpense
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
    INSERT INTO consumer_expensecategory (name, pfi_id, is_system_category, description, created_at, updated_at)
    SELECT p.pfi_number, p.id, true, '', NOW(), NOW()
    FROM consumer_pfi p
    LEFT JOIN consumer_expensecategory c ON c.pfi_id = p.id
    WHERE c.id IS NULL
    ON CONFLICT DO NOTHING
    RETURNING id, name
  `;
  return rows;
};

// ─── Expenses ───────────────────────────────────────────────────────────────

// The GL pair travels with every expense read — joined, never copied onto the
// row, so a corrected account name can never disagree with the code. Payment
// extras (VAT/WHT/vendor/invoice) join the same way, from pfi_expense_extras.
const GL_COLS = client`c.name AS category_name, cx.gl_code, cx.gl_group, cx.gl_subgroup`;
const EXTRAS_COLS = client`
  ex.vendor_id, ex.tin_number, ex.invoice_number, ex.amount_ex_vat, ex.vat_amount,
  ex.invoice_amount, ex.wht_deduction, ex.wht_rate, ex.bank_code,
  ex.payment_reference, ex.payment_date, ex.payment_method, ex.payment_notes
`;
const EXTRAS_JOIN = client`LEFT JOIN sman.pfi_expense_extras ex ON ex.expense_id = e.id`;

const findExpenseById = async (id) => {
  const [row] = await client`
    SELECT e.*, ${GL_COLS}, ${EXTRAS_COLS}, c.is_system_category, p.pfi_number
    FROM consumer_pfiexpense e
    JOIN consumer_expensecategory c ON c.id = e.category_id
    LEFT JOIN sman.expense_category_extras cx ON cx.category_id = c.id
    ${EXTRAS_JOIN}
    LEFT JOIN consumer_pfi p ON p.id = e.pfi_id
    WHERE e.id = ${Number(id)}
  `;
  return row || null;
};

const listExpensesForPfi = async (pfiId) => {
  return client`
    SELECT e.*, ${GL_COLS}, ${EXTRAS_COLS}
    FROM consumer_pfiexpense e
    JOIN consumer_expensecategory c ON c.id = e.category_id
    LEFT JOIN sman.expense_category_extras cx ON cx.category_id = c.id
    ${EXTRAS_JOIN}
    WHERE e.pfi_id = ${Number(pfiId)} AND e.deleted_at IS NULL
    ORDER BY e.date DESC, e.id DESC
  `;
};

/**
 * The expenses page: filterable list plus the totals it shows in its cards.
 * Both come off the same WHERE so the cards can never disagree with the rows.
 */
const listExpenses = async ({
  search,
  categoryId,
  /** One of GL_GROUPS — narrows to a whole section of the chart at once. */
  glGroup,
  pfiId,
  vendorId,
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
  /** The authenticated caller, for PFI scoping (undefined = unfiltered). */
  scopeUser = null,
} = {}) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 25));
  const offset = (pageNum - 1) * limitNum;

  // Scoping goes on first so every count, total, page and the bank list all
  // inherit it. Without that the bank dropdown leaks which accounts colleagues
  // pay from even when their rows are hidden.
  const base = [client`e.deleted_at IS NULL`];
  if (onlySubmitterId != null) {
    base.push(client`e.added_by_id = ${Number(onlySubmitterId)}`);
  }
  // A location-scoped user sees a line if it's tagged to a PFI directly
  // granted in their scope. consumer_pfi has no depot/LPG-station link (only
  // a state via locationId — see this file's header comment), so the old
  // depot/LPG-implied scope can't be replicated; this is deliberately
  // narrower rather than guessed wider. A general expense (pfi_id IS NULL)
  // has no PFI to check it against, so it fails closed — invisible to a
  // scoped user, same rule as everywhere else in this feature.
  if (scopeUser && !scopeUser.canViewAllLocations) {
    const { pfiIds = [] } = scopeUser.scope || {};
    base.push(client`e.pfi_id = ANY(${pfiIds})`);
  }

  if (search) {
    const p = `%${search}%`;
    base.push(
      client`(e.description ILIKE ${p} OR e.vendor ILIKE ${p} OR c.name ILIKE ${p}
              OR e.bank_paid_from ILIKE ${p} OR e.receipt_reference ILIKE ${p}
              OR ex.invoice_number ILIKE ${p} OR ex.tin_number ILIKE ${p}
              OR cx.gl_code ILIKE ${p})`
    );
  }
  if (categoryId === "none") base.push(client`e.category_id IS NULL`);
  else if (categoryId && categoryId !== "all") base.push(client`e.category_id = ${Number(categoryId)}`);
  if (glGroup && glGroup !== "all") base.push(client`cx.gl_group = ${glGroup}`);
  if (pfiId && pfiId !== "all") base.push(client`e.pfi_id = ${Number(pfiId)}`);
  if (vendorId && vendorId !== "all") base.push(client`ex.vendor_id = ${Number(vendorId)}`);
  if (bank) base.push(client`LOWER(e.bank_paid_from) = LOWER(${bank})`);
  if (type === "pfi") base.push(client`e.pfi_id IS NOT NULL`);
  if (type === "general") base.push(client`e.pfi_id IS NULL`);
  if (dateFrom) base.push(client`e.date >= ${dateFrom}`);
  if (dateTo) base.push(client`e.date <= ${dateTo}`);
  // A malformed month is ignored rather than erroring — it arrives from a URL.
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    base.push(client`to_char(e.date, 'YYYY-MM') = ${month}`);
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
      SELECT e.*, ${GL_COLS}, ${EXTRAS_COLS}, c.is_system_category, p.pfi_number,
             sub.full_name AS submitted_by_name,
             rev.full_name AS reviewed_by_name,
             (SELECT COUNT(*)::int FROM consumer_pfiexpenseattachment a WHERE a.expense_id = e.id)
               AS attachment_count
      FROM consumer_pfiexpense e
      JOIN consumer_expensecategory c ON c.id = e.category_id
      LEFT JOIN sman.expense_category_extras cx ON cx.category_id = c.id
      ${EXTRAS_JOIN}
      LEFT JOIN consumer_pfi p ON p.id = e.pfi_id
      LEFT JOIN administration_user sub ON sub.id = e.added_by_id
      LEFT JOIN administration_user rev ON rev.id = e.reviewed_by_id
      WHERE ${rowClause}
      ORDER BY e.date DESC, e.id DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `,
    // Totals cover the whole filtered set, never just the page, so the summary
    // can never disagree with the filter above it.
    client`
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(${SPEND}), 0)::text AS total,
        COALESCE(SUM(${SPEND}) FILTER (WHERE e.pfi_id IS NOT NULL), 0)::text AS pfi_total,
        COALESCE(SUM(${SPEND}) FILTER (WHERE e.pfi_id IS NULL), 0)::text AS general_total,
        COALESCE(SUM(${SPEND}) FILTER (WHERE e.status = 'paid'), 0)::text AS paid_total,
        COALESCE(SUM(e.amount) FILTER (WHERE e.status = ANY(${OPEN_STATES})), 0)::text AS open_total
      FROM consumer_pfiexpense e
      JOIN consumer_expensecategory c ON c.id = e.category_id
      LEFT JOIN sman.expense_category_extras cx ON cx.category_id = c.id
      ${EXTRAS_JOIN}
      LEFT JOIN consumer_pfi p ON p.id = e.pfi_id
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
      FROM consumer_pfiexpense e
      JOIN consumer_expensecategory c ON c.id = e.category_id
      LEFT JOIN sman.pfi_expense_extras ex ON ex.expense_id = e.id
      WHERE ${baseClause}
    `,
    client`
      SELECT DISTINCT e.bank_paid_from
      FROM consumer_pfiexpense e
      JOIN consumer_expensecategory c ON c.id = e.category_id
      LEFT JOIN sman.pfi_expense_extras ex ON ex.expense_id = e.id
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
    SELECT e.*, ${GL_COLS}, ${EXTRAS_COLS}, c.is_system_category, p.pfi_number,
           sub.full_name AS submitted_by_name
    FROM consumer_pfiexpense e
    JOIN consumer_expensecategory c ON c.id = e.category_id
    LEFT JOIN sman.expense_category_extras cx ON cx.category_id = c.id
    ${EXTRAS_JOIN}
    LEFT JOIN consumer_pfi p ON p.id = e.pfi_id
    LEFT JOIN administration_user sub ON sub.id = e.added_by_id
    WHERE e.id = ${Number(id)}
  `;
  if (!row) return null;

  const [attachments, history, comments] = await Promise.all([
    client`
      SELECT a.*, s.full_name AS uploaded_by_name
      FROM consumer_pfiexpenseattachment a
      LEFT JOIN administration_user s ON s.id = a.uploaded_by_id
      WHERE a.expense_id = ${row.id} ORDER BY a.uploaded_at
    `,
    // Reasons are read from the audit table, never from review_note — that
    // column is overwritten on every transition, so a rejection reason would
    // vanish the moment the corrected request was approved.
    client`
      SELECT a.action, a.changed_fields, a.performed_at, s.full_name AS actor_name
      FROM consumer_pfiexpenseaudit a
      LEFT JOIN administration_user s ON s.id = a.performed_by_id
      WHERE a.expense_id = ${row.id}
      ORDER BY a.performed_at ASC, a.id ASC
    `,
    listComments(row.id),
  ]);

  return { ...row, attachments, history, comments };
};

// ─── The conversation ───────────────────────────────────────────────────────

const listComments = async (expenseId) =>
  client`
    SELECT m.id, m.body, m.author_id, m.created_at,
           COALESCE(NULLIF(TRIM(s.full_name), ''), m.author_name) AS author_name,
           s.roles AS author_roles
    FROM sman.pfi_expense_comments m
    LEFT JOIN administration_user s ON s.id = m.author_id
    WHERE m.expense_id = ${Number(expenseId)}
    ORDER BY m.created_at ASC, m.id ASC
  `;

const addComment = async ({ expenseId, body, authorId, authorName }) => {
  const [row] = await client`
    INSERT INTO sman.pfi_expense_comments (expense_id, body, author_id, author_name)
    VALUES (${Number(expenseId)}, ${body}, ${authorId ?? null}, ${authorName || ""})
    RETURNING *
  `;
  return row;
};

const createExpense = async (data, tx = client) => {
  const { vendorId, tinNumber, invoiceNumber, amountExVat, vatAmount, invoiceAmount,
    whtDeduction, whtRate, bankCode, paymentReference, paymentDate, paymentMethod, paymentNotes,
    ...core } = data;

  const [row] = await tx`
    INSERT INTO consumer_pfiexpense ${tx(core)} RETURNING *
  `;

  const hasExtras = [vendorId, tinNumber, invoiceNumber, amountExVat, vatAmount, invoiceAmount,
    whtDeduction, whtRate, bankCode, paymentReference, paymentDate, paymentMethod, paymentNotes]
    .some((v) => v !== undefined);
  if (hasExtras) {
    await tx`
      INSERT INTO sman.pfi_expense_extras (
        expense_id, vendor_id, tin_number, invoice_number, amount_ex_vat, vat_amount,
        invoice_amount, wht_deduction, wht_rate, bank_code, payment_reference,
        payment_date, payment_method, payment_notes
      )
      VALUES (
        ${row.id}, ${vendorId ?? null}, ${tinNumber || ""}, ${invoiceNumber || ""},
        ${amountExVat ?? null}, ${vatAmount ?? null}, ${invoiceAmount ?? null},
        ${whtDeduction ?? null}, ${whtRate ?? null}, ${bankCode || ""},
        ${paymentReference || ""}, ${paymentDate ?? null}, ${paymentMethod || ""}, ${paymentNotes || ""}
      )
    `;
  }
  return findExpenseById(row.id);
};

const updateExpense = async (id, data, tx = client) => {
  const numId = Number(id);
  const { vendorId, tinNumber, invoiceNumber, amountExVat, vatAmount, invoiceAmount,
    whtDeduction, whtRate, bankCode, paymentReference, paymentDate, paymentMethod, paymentNotes,
    ...core } = data;

  if (Object.keys(core).length > 0) {
    await tx`
      UPDATE consumer_pfiexpense SET ${tx({ ...core, updated_at: new Date().toISOString() })}
      WHERE id = ${numId} AND deleted_at IS NULL
    `;
  }

  const extras = { vendorId, tinNumber, invoiceNumber, amountExVat, vatAmount, invoiceAmount,
    whtDeduction, whtRate, bankCode, paymentReference, paymentDate, paymentMethod, paymentNotes };
  const hasExtras = Object.values(extras).some((v) => v !== undefined);
  if (hasExtras) {
    await tx`
      INSERT INTO sman.pfi_expense_extras (
        expense_id, vendor_id, tin_number, invoice_number, amount_ex_vat, vat_amount,
        invoice_amount, wht_deduction, wht_rate, bank_code, payment_reference,
        payment_date, payment_method, payment_notes
      )
      VALUES (
        ${numId}, ${vendorId ?? null}, ${tinNumber ?? ""}, ${invoiceNumber ?? ""},
        ${amountExVat ?? null}, ${vatAmount ?? null}, ${invoiceAmount ?? null},
        ${whtDeduction ?? null}, ${whtRate ?? null}, ${bankCode ?? ""},
        ${paymentReference ?? ""}, ${paymentDate ?? null}, ${paymentMethod ?? ""}, ${paymentNotes ?? ""}
      )
      ON CONFLICT (expense_id) DO UPDATE SET
        vendor_id = COALESCE(EXCLUDED.vendor_id, sman.pfi_expense_extras.vendor_id),
        tin_number = COALESCE(NULLIF(EXCLUDED.tin_number, ''), sman.pfi_expense_extras.tin_number),
        invoice_number = COALESCE(NULLIF(EXCLUDED.invoice_number, ''), sman.pfi_expense_extras.invoice_number),
        amount_ex_vat = COALESCE(EXCLUDED.amount_ex_vat, sman.pfi_expense_extras.amount_ex_vat),
        vat_amount = COALESCE(EXCLUDED.vat_amount, sman.pfi_expense_extras.vat_amount),
        invoice_amount = COALESCE(EXCLUDED.invoice_amount, sman.pfi_expense_extras.invoice_amount),
        wht_deduction = COALESCE(EXCLUDED.wht_deduction, sman.pfi_expense_extras.wht_deduction),
        wht_rate = COALESCE(EXCLUDED.wht_rate, sman.pfi_expense_extras.wht_rate),
        bank_code = COALESCE(NULLIF(EXCLUDED.bank_code, ''), sman.pfi_expense_extras.bank_code),
        payment_reference = COALESCE(NULLIF(EXCLUDED.payment_reference, ''), sman.pfi_expense_extras.payment_reference),
        payment_date = COALESCE(EXCLUDED.payment_date, sman.pfi_expense_extras.payment_date),
        payment_method = COALESCE(NULLIF(EXCLUDED.payment_method, ''), sman.pfi_expense_extras.payment_method),
        payment_notes = COALESCE(NULLIF(EXCLUDED.payment_notes, ''), sman.pfi_expense_extras.payment_notes),
        updated_at = NOW()
    `;
  }

  return findExpenseById(numId);
};

/** Soft delete — the row stays and drops out of every total. */
const softDeleteExpense = async (id) => {
  const [row] = await client`
    UPDATE consumer_pfiexpense SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = ${Number(id)} AND deleted_at IS NULL
    RETURNING *
  `;
  return row || null;
};

const writeAudit = async ({ expenseId, action, changes, actorId, ipAddress }, tx = client) => {
  await tx`
    INSERT INTO consumer_pfiexpenseaudit (expense_id, action, changed_fields, performed_by_id, performed_at, ip_address)
    VALUES (${expenseId ?? null}, ${action}, ${JSON.stringify(changes || {})},
            ${actorId ?? null}, NOW(), ${ipAddress || ""})
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
  { pfiId, orderId, action = "RELEASE", qtyLitres, recordedBy },
  tx = client
) => {
  const [row] = await tx`
    INSERT INTO consumer_pfimovement (pfi_id, order_id, action, qty_litres, user_id, timestamp)
    VALUES (${Number(pfiId)}, ${orderId ?? null}, ${action}, ${Number(qtyLitres)},
            ${recordedBy ?? null}, NOW())
    ON CONFLICT (action, order_id) DO NOTHING
    RETURNING *
  `;
  return row || null;
};

const listMovements = async (pfiId) => {
  return client`
    SELECT m.*, o.id AS order_id, o.status AS order_status,
           COALESCE(NULLIF(TRIM(c.company_name), ''), c.first_name || ' ' || c.last_name) AS customer_name
    FROM consumer_pfimovement m
    LEFT JOIN consumer_order o ON o.id = m.order_id
    LEFT JOIN consumer_customer c ON c.id = o.user_id
    WHERE m.pfi_id = ${Number(pfiId)}
    ORDER BY m.timestamp DESC
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
  listComments,
  addComment,
  writeAudit,
  recordMovement,
  listMovements,
};
