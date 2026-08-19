// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { db } = require("../config/db");
const { orderRepo, auditLogRepo } = require("../repositories");
const orderStatus = require("../services/orderStatus.service");
const { ensureTestStaff, closeDb } = require("./helpers");
const { seedState, seedProduct, seedCustomer, seedOrder } = require("./liveFixtures");

// The state machine speaks Sman vocabulary (Pending/Paid/…); the live
// consumer_order.status column stores Django's lowercase values, with
// Loading/Completed sharing "loaded" (disambiguated by release_status) —
// see utils/orderStatusMapping.js. Seeding a starting status therefore
// means writing the LIVE value the mapping reads back as the Sman one.
const LIVE_SEED = Object.freeze({
  Pending: { status: "pending" },
  Paid: { status: "paid" },
  Released: { status: "released" },
  Loading: { status: "loaded" }, // releaseStatus stays "pending"
  Completed: { status: "loaded", releaseStatus: "picked" },
  Cancelled: { status: "canceled" },
});

describe("order state machine — legal transitions, atomic with audit, single-winner", () => {
  let customerId;
  let staffId;
  let stateId;
  let productId;

  before(async () => {
    customerId = (await seedCustomer()).id;
    staffId = (await ensureTestStaff()).id;
    stateId = (await seedState()).id;
    productId = (await seedProduct()).id;
  });

  after(async () => {
    await closeDb();
  });

  // A minimal valid order row for driving the state machine directly.
  // No depotId — live orders carry stateId only (see order.repository.js).
  const makeOrder = (status = "Pending") =>
    seedOrder({
      customerId,
      stateId,
      productId,
      quantity: 1000,
      price: "100.00",
      ...LIVE_SEED[status],
    });

  test("the legal-transition map matches the agreed pipeline", () => {
    assert.ok(orderStatus.isLegal("Pending", "Paid"));
    assert.ok(orderStatus.isLegal("Paid", "Released"));
    assert.ok(orderStatus.isLegal("Released", "Loading"));
    assert.ok(orderStatus.isLegal("Loading", "Completed"));
    // Cancel allowed through Released, never from Loading on.
    assert.ok(orderStatus.isLegal("Pending", "Cancelled"));
    assert.ok(orderStatus.isLegal("Released", "Cancelled"));
    assert.ok(!orderStatus.isLegal("Loading", "Cancelled"));
    // Expire only from Pending — a funded (Paid+) order can never lapse.
    assert.ok(orderStatus.isLegal("Pending", "Expired"));
    assert.ok(!orderStatus.isLegal("Paid", "Expired"));
    assert.ok(!orderStatus.isLegal("Released", "Expired"));
    // No backwards / skips.
    assert.ok(!orderStatus.isLegal("Loading", "Pending"));
    assert.ok(!orderStatus.isLegal("Pending", "Released"));
    assert.ok(!orderStatus.isLegal("Completed", "Cancelled"));
  });

  test("a legal transition writes status, its stage column and an audit row together", async () => {
    const order = await makeOrder("Paid");

    // Live stage columns: released_at + released_by_id (FK to
    // administration_user) — the old releasedBy column is gone.
    const updated = await orderStatus.transition(order.id, "Released", {
      actor: { type: "staff", staffId },
      set: { releasedAt: new Date().toISOString(), releasedById: staffId },
      metadata: { note: "test release" },
    });

    assert.equal(updated.status, "Released");
    assert.ok(updated.releasedAt, "stage column stamped");
    assert.equal(updated.releasedById, staffId);

    const events = await auditLogRepo.findByEntity("order", order.id);
    const released = events.find((e) => e.newState === "Released");
    assert.ok(released, "an audit row was written");
    assert.equal(released.prevState, "Paid");
    assert.equal(released.actorType, "staff");
    assert.equal(released.actorStaffId, staffId);
    assert.equal(released.action, "order.released");
  });

  test("an illegal transition is refused with 409 and writes nothing", async () => {
    const order = await makeOrder("Loading");

    await assert.rejects(
      orderStatus.transition(order.id, "Pending", { actor: { type: "system" } }),
      (err) => err.status === 409
    );

    const after = await orderRepo.findById(order.id);
    assert.equal(after.status, "Loading", "status unchanged");
    const events = await auditLogRepo.findByEntity("order", order.id);
    assert.equal(events.length, 0, "no audit row for a refused transition");
  });

  test("re-issuing the same status is refused (idempotency guard)", async () => {
    const order = await makeOrder("Paid");
    await assert.rejects(
      orderStatus.transition(order.id, "Paid", { actor: { type: "system" } }),
      (err) => err.status === 409
    );
  });

  test("the audit row rolls back with a failed transition", async () => {
    // If the status update and the audit write were not one transaction, a
    // failure after the update would leave a status change with no trail.
    const order = await makeOrder("Pending");

    await assert.rejects(
      db.transaction(async (tx) => {
        await orderStatus.transition(order.id, "Paid", {
          actor: { type: "system" },
          set: { paymentConfirmedAt: new Date().toISOString() },
          tx,
        });
        throw new Error("boom after the transition");
      }),
      /boom/
    );

    const after = await orderRepo.findById(order.id);
    assert.equal(after.status, "Pending", "status rolled back");
    const events = await auditLogRepo.findByEntity("order", order.id);
    assert.equal(events.length, 0, "audit row rolled back too");
  });

  test("a system actor writes an audit row with no staff/customer id", async () => {
    const order = await makeOrder("Pending");
    await orderStatus.transition(order.id, "Paid", {
      actor: { type: "system" },
      set: { paymentConfirmedAt: new Date().toISOString() },
    });
    const [event] = await auditLogRepo.findByEntity("order", order.id);
    assert.equal(event.actorType, "system");
    assert.equal(event.actorStaffId, null);
    assert.equal(event.actorCustomerId, null);
  });

  test("two concurrent transitions to the same target yield a single winner", async () => {
    // The row lock closes the concurrent double-action race (e.g. two cancels,
    // each refunding): one caller locks, the other waits, re-reads the now-new
    // status, and finds its move illegal — here, "already Released".
    const order = await makeOrder("Paid");

    const results = await Promise.allSettled([
      orderStatus.transition(order.id, "Released", {
        actor: { type: "staff", staffId },
        set: { releasedAt: new Date().toISOString(), releasedById: staffId },
      }),
      orderStatus.transition(order.id, "Released", {
        actor: { type: "staff", staffId },
        set: { releasedAt: new Date().toISOString(), releasedById: staffId },
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    assert.equal(fulfilled.length, 1, "exactly one transition committed");
    const rejected = results.find((r) => r.status === "rejected");
    assert.equal(rejected.reason.status, 409, "the loser is a clean 409");

    const after = await orderRepo.findById(order.id);
    assert.equal(after.status, "Released");
    // Exactly one audit row — the loser's rolled back with its transaction.
    const events = await auditLogRepo.findByEntity("order", order.id);
    assert.equal(events.length, 1, "one order, one committed transition, one audit row");
  });

  test("findStateTimeline returns only state-changing events, in order", async () => {
    const order = await makeOrder("Pending");
    await orderStatus.transition(order.id, "Paid", {
      actor: { type: "system" },
      set: { paymentConfirmedAt: new Date().toISOString() },
    });
    await orderStatus.transition(order.id, "Released", {
      actor: { type: "staff", staffId },
      set: { releasedAt: new Date().toISOString(), releasedById: staffId },
    });

    const timeline = await auditLogRepo.findStateTimeline("order", order.id);
    assert.deepEqual(
      timeline.map((e) => e.newState),
      ["Paid", "Released"],
      "in pipeline order"
    );
  });
});
