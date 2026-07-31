// Must precede any require that reaches config/db, which reads DATABASE_URL at
// module load (same rule as the other test files).
require("dotenv").config();

const { test, describe } = require("node:test");
const assert = require("node:assert");
const {
  TRANSITIONS,
  STAGE_STAMPS,
  canTransition,
} = require("../services/dangoteDelivery/transitions");

// The frontend contract's 14 statuses, verbatim (types.ts). The machine must
// cover exactly this set — no extras, none missing.
const ALL_STATUSES = [
  "DRAFT",
  "DOCUMENTS_SUBMITTED",
  "AGREEMENT_ACCEPTED",
  "UNDER_REVIEW",
  "NEEDS_CHANGES",
  "APPROVED",
  "PAYMENT_PENDING",
  "PAID",
  "SCHEDULED",
  "DISPATCHED",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "DOCUMENTS_EXPIRED",
];

describe("dangote delivery transition map", () => {
  test("covers exactly the 14 contract statuses", () => {
    assert.deepStrictEqual(Object.keys(TRANSITIONS).sort(), [...ALL_STATUSES].sort());
  });

  test("every target is a known status", () => {
    for (const [from, targets] of Object.entries(TRANSITIONS)) {
      for (const to of targets) {
        assert.ok(ALL_STATUSES.includes(to), `${from} → ${to}: unknown target`);
      }
    }
  });

  test("terminal statuses have no exits", () => {
    for (const terminal of ["COMPLETED", "CANCELLED", "REJECTED", "DOCUMENTS_EXPIRED"]) {
      assert.deepStrictEqual(TRANSITIONS[terminal], [], `${terminal} must be terminal`);
    }
  });

  test("happy path is fully connected: draft → completed", () => {
    const path = [
      "DRAFT",
      "DOCUMENTS_SUBMITTED",
      "AGREEMENT_ACCEPTED",
      "UNDER_REVIEW",
      "APPROVED",
      "PAYMENT_PENDING",
      "PAID",
      "SCHEDULED",
      "DISPATCHED",
      "COMPLETED",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      assert.ok(canTransition(path[i], path[i + 1]), `${path[i]} → ${path[i + 1]} must be legal`);
    }
  });

  test("needs-changes loop: review → needs changes → draft, and re-submit", () => {
    assert.ok(canTransition("UNDER_REVIEW", "NEEDS_CHANGES"));
    assert.ok(canTransition("NEEDS_CHANGES", "DRAFT"));
    assert.ok(canTransition("DRAFT", "DOCUMENTS_SUBMITTED"));
  });

  test("payment is impossible before approval", () => {
    for (const from of ["DRAFT", "DOCUMENTS_SUBMITTED", "AGREEMENT_ACCEPTED", "UNDER_REVIEW", "NEEDS_CHANGES"]) {
      assert.ok(!canTransition(from, "PAID"), `${from} → PAID must be illegal`);
      assert.ok(!canTransition(from, "PAYMENT_PENDING"), `${from} → PAYMENT_PENDING must be illegal`);
    }
  });

  test("no shortcut from review straight to paid or completed", () => {
    assert.ok(!canTransition("UNDER_REVIEW", "PAID"));
    assert.ok(!canTransition("UNDER_REVIEW", "COMPLETED"));
    assert.ok(!canTransition("APPROVED", "PAID"));
  });

  test("cancellation stops at payment: paid and beyond cannot cancel", () => {
    for (const from of ["DRAFT", "DOCUMENTS_SUBMITTED", "AGREEMENT_ACCEPTED", "UNDER_REVIEW", "NEEDS_CHANGES", "APPROVED", "PAYMENT_PENDING"]) {
      assert.ok(canTransition(from, "CANCELLED"), `${from} → CANCELLED must be legal`);
    }
    for (const from of ["PAID", "SCHEDULED", "DISPATCHED", "COMPLETED"]) {
      assert.ok(!canTransition(from, "CANCELLED"), `${from} → CANCELLED must be illegal`);
    }
  });

  test("documents can expire only from approved or scheduled", () => {
    assert.ok(canTransition("APPROVED", "DOCUMENTS_EXPIRED"));
    assert.ok(canTransition("SCHEDULED", "DOCUMENTS_EXPIRED"));
    for (const from of ALL_STATUSES.filter((s) => !["APPROVED", "SCHEDULED"].includes(s))) {
      assert.ok(!canTransition(from, "DOCUMENTS_EXPIRED"), `${from} → DOCUMENTS_EXPIRED must be illegal`);
    }
  });

  test("stage stamps map only to real statuses and real columns", () => {
    const stampColumns = [
      "submittedAt", "approvedAt", "paidAt", "scheduledAt",
      "dispatchedAt", "completedAt", "cancelledAt",
    ];
    for (const [status, column] of Object.entries(STAGE_STAMPS)) {
      assert.ok(ALL_STATUSES.includes(status), `stamp for unknown status ${status}`);
      assert.ok(stampColumns.includes(column), `unknown stamp column ${column}`);
    }
  });

  test("unknown statuses never transition", () => {
    assert.ok(!canTransition("NOT_A_STATUS", "DRAFT"));
    assert.ok(!canTransition("DRAFT", "NOT_A_STATUS"));
  });
});
