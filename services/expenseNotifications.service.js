const { client } = require("../db");
const { notificationRepo } = require("../repositories");
const chain = require("../lib/expenseChain");

/**
 * Who hears about each stage, by role rather than by name — adding a second
 * officer needs no code change here.
 */
const STAGE_RECIPIENTS = {
  [chain.STATUS.PENDING]: { roles: [chain.ROLE.OFFICER], title: "New expense awaiting verification" },
  [chain.STATUS.VERIFIED]: { roles: [chain.ROLE.CFO], title: "Expense verified — your approval needed" },
  [chain.STATUS.AUDIT_APPROVED]: { roles: [chain.ROLE.ADMIN], title: "Expense approved — final sign-off needed" },
  [chain.STATUS.ADMIN_APPROVED]: { roles: [chain.ROLE.OFFICER], title: "Expense authorised — ready to pay" },
  // These two go to everyone who touched the request, not to a role.
  [chain.STATUS.PAID]: { participants: true, title: "Expense paid" },
  [chain.STATUS.REJECTED]: { participants: true, title: "Expense rejected" },
  [chain.STATUS.CHANGES_REQUESTED]: { submitterOnly: true, title: "Expense sent back for changes" },
};

const naira = (v) =>
  `₦${Number(v || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Staff holding any of these roles, active only. */
const staffWithRoles = async (roles) => {
  if (!roles?.length) return [];
  const rows = await client`
    SELECT id FROM staff
    WHERE is_active = true AND roles && ${roles}
  `;
  return rows.map((r) => r.id);
};

/** Everyone who has signed or raised this request. */
const participantsOf = (e) =>
  [e.added_by, e.recorded_by, e.verified_by, e.audit_approved_by, e.admin_approved_by, e.paid_by]
    .filter((v) => v != null)
    .map(Number);

/**
 * Announce a stage change.
 *
 * Recipients are resolved here (cheap DB reads) and the write is a single
 * bulk insert. Nothing in this function is awaited by the request handler —
 * see the call site — because sending inline once cost a production outage:
 * an SMTP connect plus one HTTP call per SMS recipient, sequentially inside
 * the POST, outran the worker timeout. The worker was killed, the browser saw
 * a bare network failure, and users retried an expense that had already
 * committed.
 */
async function notifyExpenseStage({ expense, stage, note, actorId, actorName }) {
  const spec = STAGE_RECIPIENTS[stage];
  if (!spec) return;

  let recipients = [];
  if (spec.participants) recipients = participantsOf(expense);
  else if (spec.submitterOnly) recipients = [expense.added_by ?? expense.recorded_by].filter(Boolean).map(Number);
  else recipients = await staffWithRoles(spec.roles);

  // Whoever just acted already knows.
  recipients = [...new Set(recipients)].filter((id) => Number(id) !== Number(actorId));
  if (recipients.length === 0) return;

  const label = chain.STATUS_LABELS[stage] || stage;
  const body = [
    `${naira(expense.amount)} to ${expense.vendor || "an unnamed payee"}`,
    note ? `— "${note.trim()}"` : "",
    actorName ? `(${actorName})` : "",
  ]
    .filter(Boolean)
    .join(" ");

  await notificationRepo.createMany(
    recipients.map((staffId) => ({
      recipientType: "staff",
      staffId,
      type: `expense.${stage}`,
      category: "payments",
      priority: stage === chain.STATUS.REJECTED ? "high" : "normal",
      title: spec.title,
      body,
      entityType: "pfi_expense",
      entityId: String(expense.id),
      actionUrl: `/expenses?expense=${expense.id}`,
      data: { expenseId: expense.id, status: stage, label, amount: String(expense.amount) },
    })),
  );
}

module.exports = { notifyExpenseStage, STAGE_RECIPIENTS };
