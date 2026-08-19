/**
 * The expense approval chain — one place, so adding a stage is a data change.
 *
 * An expense is a payment request that walks four sign-offs, each by a
 * different role, and only becomes spending at the end. Nothing here is
 * duplicated in the views: the views ask this module what is allowed.
 *
 * Roles are this app's own strings. Mapped from Django's real Roles.IntegerChoices
 * (see config/roleMapping.js for the full, verified table):
 *
 *   SuperAdmin (0)           -> super_admin
 *   Admin (1)                -> admin
 *   Finance (2)              -> finance   ("CFO" here is this role's function in
 *      the approval chain, not its Django name — Django's own AUDITOR(8) role is
 *      read-only everywhere (see IsAuditorReadOnly in administration/permissions.py)
 *      and cannot be this stage; ConfirmPaymentAPIView confirms FINANCE is the
 *      role Django itself trusts with payment actions)
 *   Expenditure Officer (19) -> expenditure_officer
 */

const ROLE = {
  SUPER: "super_admin",
  ADMIN: "admin",
  CFO: "finance",
  OFFICER: "expenditure_officer",
};

const STATUS = {
  PENDING: "pending",
  VERIFIED: "verified",
  AUDIT_APPROVED: "audit_approved",
  ADMIN_APPROVED: "admin_approved",
  PAID: "paid",
  REJECTED: "rejected",
  CHANGES_REQUESTED: "changes_requested",
};

/**
 * Everything that is committed but has not left the bank.
 *
 * Read this rather than listing statuses inline — the same set is needed by
 * the list filters, the summary totals and the cost calculation, and they must
 * never drift apart.
 */
const OPEN_STATES = [
  STATUS.PENDING,
  STATUS.VERIFIED,
  STATUS.AUDIT_APPROVED,
  STATUS.ADMIN_APPROVED,
  STATUS.CHANGES_REQUESTED,
];

/**
 * Named after whoever has to act next, because that is the only thing anyone
 * reads a status for. The four sign-offs are: Expenditure Officer verifies,
 * CFO approves, Admin gives final approval, Expenditure Officer pays.
 */
const STATUS_LABELS = {
  [STATUS.PENDING]: "With Expenditure Officer",
  [STATUS.VERIFIED]: "With CFO",
  [STATUS.AUDIT_APPROVED]: "Awaiting final approval",
  [STATUS.ADMIN_APPROVED]: "Approved — awaiting payment",
  [STATUS.PAID]: "Paid",
  [STATUS.REJECTED]: "Rejected",
  [STATUS.CHANGES_REQUESTED]: "Changes requested",
};

/** Where a status sits in the four-step chain, for a "2 of 4" counter. */
const STATUS_STEP = {
  [STATUS.PENDING]: 0,
  [STATUS.CHANGES_REQUESTED]: 0,
  [STATUS.VERIFIED]: 1,
  [STATUS.AUDIT_APPROVED]: 2,
  [STATUS.ADMIN_APPROVED]: 3,
  [STATUS.PAID]: 4,
};
const TOTAL_STEPS = 4;

/**
 * The whole state machine. Adding a stage means adding a row here plus a stamp
 * pair below — no view logic changes.
 */
const TRANSITIONS = {
  verify: {
    roles: [ROLE.SUPER, ROLE.OFFICER],
    from: [STATUS.PENDING, STATUS.CHANGES_REQUESTED],
    to: STATUS.VERIFIED,
    label: "Verify",
  },
  audit_approve: {
    roles: [ROLE.SUPER, ROLE.CFO],
    from: [STATUS.VERIFIED],
    to: STATUS.AUDIT_APPROVED,
    label: "CFO approve",
  },
  admin_approve: {
    roles: [ROLE.SUPER, ROLE.ADMIN],
    from: [STATUS.AUDIT_APPROVED],
    to: STATUS.ADMIN_APPROVED,
    label: "Give final approval",
  },
  mark_paid: {
    roles: [ROLE.SUPER, ROLE.OFFICER],
    from: [STATUS.ADMIN_APPROVED],
    to: STATUS.PAID,
    label: "Mark paid",
    /**
     * The one transition that records facts of its own. Nobody knows which
     * account the money will leave from, or what will actually clear against
     * the amount requested, until it happens — so the officer supplies both
     * here and the controller refuses the transition without them.
     */
    capturesPayment: true,
  },
  reject: {
    roles: [ROLE.SUPER, ROLE.ADMIN, ROLE.CFO, ROLE.OFFICER],
    from: [
      STATUS.PENDING, STATUS.VERIFIED, STATUS.AUDIT_APPROVED,
      STATUS.ADMIN_APPROVED, STATUS.CHANGES_REQUESTED,
    ],
    to: STATUS.REJECTED,
    label: "Reject",
    requiresNote: true,
  },
  request_changes: {
    roles: [ROLE.SUPER, ROLE.ADMIN, ROLE.CFO, ROLE.OFFICER],
    from: [
      STATUS.PENDING, STATUS.VERIFIED, STATUS.AUDIT_APPROVED, STATUS.ADMIN_APPROVED,
    ],
    to: STATUS.CHANGES_REQUESTED,
    label: "Send back",
    requiresNote: true,
  },
};

/** Landing on a stage writes its own pair, alongside the reviewed_* overwrite. */
const STAGE_STAMPS = {
  [STATUS.VERIFIED]: ["verifiedBy", "verifiedAt"],
  [STATUS.AUDIT_APPROVED]: ["auditApprovedBy", "auditApprovedAt"],
  [STATUS.ADMIN_APPROVED]: ["adminApprovedBy", "adminApprovedAt"],
  [STATUS.PAID]: ["paidBy", "paidAt"],
};

// ── Role sets ────────────────────────────────────────────────────────────────

/**
 * Sees everyone's spending rather than only their own. The Expenditure Officer
 * is here because verification is their job — they cannot verify a queue they
 * cannot see.
 */
const OVERSIGHT_ROLES = [ROLE.SUPER, ROLE.ADMIN, ROLE.CFO, ROLE.OFFICER];

/** May action their own request. Without this a solo operator is stuck. */
const SELF_ACTION_ROLES = [ROLE.SUPER];

const rolesOf = (user) => {
  const list = Array.isArray(user?.roles) ? user.roles : [];
  return new Set([...list, user?.role].filter(Boolean));
};

const hasAny = (user, allowed) => {
  const mine = rolesOf(user);
  return allowed.some((r) => mine.has(r));
};

const canOversee = (user) => hasAny(user, OVERSIGHT_ROLES);
const canSelfAction = (user) => hasAny(user, SELF_ACTION_ROLES);

/**
 * May read this request and take part in its conversation.
 *
 * Everyone in the chain, plus the person who raised it — they have to be able
 * to answer a query, which is the whole point of the thread. Deliberately not
 * "any authenticated member of staff": salaries and settlements go through
 * here.
 */
const canSeeExpense = (expense, user) => {
  if (canOversee(user)) return true;
  const submitterId = expense?.added_by ?? expense?.addedBy ?? expense?.recorded_by ?? expense?.recordedBy;
  return submitterId != null && Number(submitterId) === Number(user?.id);
};

/**
 * What this viewer may do to this expense, and if nothing, why.
 *
 * The reason matters as much as the list: a row of no buttons with no
 * explanation reads as a broken page, when usually it just means somebody else
 * has to act next.
 */
function availableActions(expense, user) {
  const status = expense.status;

  if (status === STATUS.PAID) {
    return { actions: [], reason: "This expense is paid and closed." };
  }
  if (status === STATUS.REJECTED) {
    return { actions: [], reason: "This request was rejected. Edit it to resubmit." };
  }

  const submitterId = expense.addedBy ?? expense.recordedBy ?? null;
  const isSubmitter = submitterId != null && Number(submitterId) === Number(user?.id);
  if (isSubmitter && !canSelfAction(user)) {
    return { actions: [], reason: "You submitted this — someone else has to action it." };
  }

  const actions = Object.entries(TRANSITIONS)
    .filter(([, t]) => t.from.includes(status) && hasAny(user, t.roles))
    .map(([name]) => name);

  if (actions.length === 0) {
    return {
      actions: [],
      reason: `Your role cannot action a request at the '${STATUS_LABELS[status] || status}' stage.`,
    };
  }
  return { actions, reason: "" };
}

/**
 * Validate a requested transition.
 *
 * Returns `{ ok: true, transition }` or `{ ok: false, status, message, currentStatus }`.
 * The order of checks is deliberate — each yields a different HTTP status and
 * the specific one has to win.
 */
function checkTransition(expense, action, user, note) {
  const transition = TRANSITIONS[action];
  if (!transition) {
    return { ok: false, status: 400, message: `Unknown action '${action}'` };
  }
  if (!hasAny(user, transition.roles)) {
    return { ok: false, status: 403, message: `Your role cannot ${transition.label.toLowerCase()} an expense` };
  }

  const submitterId = expense.addedBy ?? expense.recordedBy ?? null;
  const isSubmitter = submitterId != null && Number(submitterId) === Number(user?.id);
  if (isSubmitter && !canSelfAction(user)) {
    return { ok: false, status: 403, message: "You raised this request — someone else has to action it" };
  }

  // 409, not 400: two people acting from stale screens is the normal case, and
  // returning the current status lets the client refresh straight from the error.
  if (!transition.from.includes(expense.status)) {
    return {
      ok: false,
      status: 409,
      message: `Cannot ${transition.label.toLowerCase()} a request that is '${STATUS_LABELS[expense.status] || expense.status}'`,
      currentStatus: expense.status,
    };
  }

  if (transition.requiresNote && !String(note || "").trim()) {
    return { ok: false, status: 400, message: `A reason is required to ${transition.label.toLowerCase()}` };
  }

  return { ok: true, transition };
}

module.exports = {
  ROLE,
  STATUS,
  OPEN_STATES,
  STATUS_LABELS,
  STATUS_STEP,
  TOTAL_STEPS,
  TRANSITIONS,
  STAGE_STAMPS,
  OVERSIGHT_ROLES,
  canOversee,
  canSelfAction,
  canSeeExpense,
  availableActions,
  checkTransition,
  rolesOf,
};
