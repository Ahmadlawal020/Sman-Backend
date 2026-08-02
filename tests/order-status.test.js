// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { db } = require("../config/db");
const { orders, depots, products } = require("../db/schema");
const { orderRepo, customerRepo, auditLogRepo } = require("../repositories");
const orderStatus = require("../services/orderStatus.service");
const { ensureTestStaff, closeDb } = require("./helpers");

const PHONE = "+2348200000001";

async function customerFixture() {
  const existing = await customerRepo.findByPhone(PHONE);
  if (existing) return existing;
  return customerRepo.create({ name: "Status Fixture", phone: PHONE, status: "Active" });
}

// depot/product are notNull FKs on orders — reuse an existing row or make one.
async function depotFixture() {
  const [existing] = await db.select().from(depots).limit(1);
  if (existing) return existing.id;
  const [row] = await db
    .insert(depots)
    .values({
      name: "Status Depot",
      code: "STAT",
      address: "1 Test Rd",
      city: "Lagos",
      state: "Lagos",
      country: "NG",
      postcode: "100001",
      maxCapacity: 1000000,
      establishedYear: "2020",
    })
    .returning();
  return row.id;
}

async function productFixture() {
  const [existing] = await db.select().from(products).limit(1);
  if (existing) return existing.id;
  const [row] = await db
    .insert(products)
    .values({ name: "Status Product", sku: "STAT-PRD", category: "PMS" })
    .returning();
  return row.id;
}

let seq = 0;
const RUN = Date.now(); // unique per run, so order numbers don't collide across runs
// A minimal valid order row for driving the state machine directly.
async function makeOrder(customerId, depotId, productId, status = "Pending") {
  const [row] = await db
    .insert(orders)
    .values({
      orderNumber: `ORD-STAT-${RUN}-${seq++}`,
      customerId,
      state: "Lagos",
      depotId,
      productId,
      quantity: 1000,
      price: "100.00",
      totalAmount: "100000.00",
      deliveryType: "pickup",
      status,
      paymentStatus: "Unpaid",
    })
    .returning();
  return row;
}

describe("order state machine — legal transitions, atomic with audit, single-winner", () => {
  let customerId;
  let staffId;
  let depotId;
  let productId;

  before(async () => {
    customerId = (await customerFixture()).id;
    staffId = (await ensureTestStaff()).id;
    depotId = await depotFixture();
    productId = await productFixture();
  });

  after(async () => {
    await closeDb();
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
    const order = await makeOrder(customerId, depotId, productId, "Paid");

    const updated = await orderStatus.transition(order.id, "Released", {
      actor: { type: "staff", staffId },
      set: { releasedAt: new Date(), releasedBy: staffId },
      metadata: { note: "test release" },
    });

    assert.equal(updated.status, "Released");
    assert.ok(updated.releasedAt, "stage column stamped");
    assert.equal(updated.releasedBy, staffId);

    const events = await auditLogRepo.findByEntity("order", order.id);
    const released = events.find((e) => e.newState === "Released");
    assert.ok(released, "an audit row was written");
    assert.equal(released.prevState, "Paid");
    assert.equal(released.actorType, "staff");
    assert.equal(released.actorStaffId, staffId);
    assert.equal(released.action, "order.released");
  });

  test("an illegal transition is refused with 409 and writes nothing", async () => {
    const order = await makeOrder(customerId, depotId, productId, "Loading");

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
    const order = await makeOrder(customerId, depotId, productId, "Paid");
    await assert.rejects(
      orderStatus.transition(order.id, "Paid", { actor: { type: "system" } }),
      (err) => err.status === 409
    );
  });

  test("the audit row rolls back with a failed transition", async () => {
    // If the status update and the audit write were not one transaction, a
    // failure after the update would leave a status change with no trail.
    const order = await makeOrder(customerId, depotId, productId, "Pending");

    await assert.rejects(
      db.transaction(async (tx) => {
        await orderStatus.transition(order.id, "Paid", {
          actor: { type: "system" },
          set: { paymentConfirmedAt: new Date() },
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
    const order = await makeOrder(customerId, depotId, productId, "Pending");
    await orderStatus.transition(order.id, "Paid", {
      actor: { type: "system" },
      set: { paymentConfirmedAt: new Date() },
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
    const order = await makeOrder(customerId, depotId, productId, "Paid");

    const results = await Promise.allSettled([
      orderStatus.transition(order.id, "Released", {
        actor: { type: "staff", staffId },
        set: { releasedAt: new Date(), releasedBy: staffId },
      }),
      orderStatus.transition(order.id, "Released", {
        actor: { type: "staff", staffId },
        set: { releasedAt: new Date(), releasedBy: staffId },
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
    const order = await makeOrder(customerId, depotId, productId, "Pending");
    await orderStatus.transition(order.id, "Paid", {
      actor: { type: "system" },
      set: { paymentConfirmedAt: new Date() },
    });
    await orderStatus.transition(order.id, "Released", {
      actor: { type: "staff", staffId },
      set: { releasedAt: new Date(), releasedBy: staffId },
    });

    const timeline = await auditLogRepo.findStateTimeline("order", order.id);
    assert.deepEqual(
      timeline.map((e) => e.newState),
      ["Paid", "Released"],
      "in pipeline order"
    );
  });
});
