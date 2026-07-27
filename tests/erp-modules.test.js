// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { eq, inArray } = require("drizzle-orm");

const { db } = require("../config/db");
const {
  deliveryCustomers,
  deliveryInventory,
  fleetTrucks,
  fleetLedgerEntries,
  dailyReports,
  auditEvents,
} = require("../db/schema");
const deliveryService = require("../services/delivery.service");
const fleetService = require("../services/fleet.service");
const dailyReportService = require("../services/dailyReport.service");
const { fleetTruckRepo } = require("../repositories");
const { ensureTestStaff, closeDb } = require("./helpers");

// In the app this happens in app.js; tests exercising services directly need
// the audit consumer wired the same way.
require("../services/audit.service").registerAuditListener();

const suffix = Date.now().toString(36);
const actor = { type: "staff", id: null, name: "erp-test@soroman.test" };

describe("ERP modules — delivery release, fleet ledger, daily reports", () => {
  let customer;
  let staffRow;

  before(async () => {
    staffRow = await ensureTestStaff();
    [customer] = await db
      .insert(deliveryCustomers)
      .values({
        customerType: "filling_station",
        name: `ERP Test Station ${suffix}`,
        phoneNumber: `+23470${String(Date.now()).slice(-8)}`,
      })
      .returning();
  });

  after(async () => {
    const fleetRows = await db
      .select({ id: fleetTrucks.id })
      .from(fleetTrucks)
      .where(eq(fleetTrucks.plateNumber, `ERP-${suffix}`));
    if (fleetRows.length > 0) {
      await db
        .delete(fleetLedgerEntries)
        .where(inArray(fleetLedgerEntries.truckId, fleetRows.map((r) => r.id)));
      await db.delete(fleetTrucks).where(inArray(fleetTrucks.id, fleetRows.map((r) => r.id)));
    }
    await db.delete(deliveryInventory).where(eq(deliveryInventory.customerId, customer.id));
    await db.delete(dailyReports).where(eq(dailyReports.location, `ERP Test Location ${suffix}`));
    await db.delete(deliveryCustomers).where(eq(deliveryCustomers.id, customer.id));
    await closeDb();
  });

  test("delivery release workflow: pending -> confirmed -> released, one-way", async () => {
    const [allocation] = await db
      .insert(deliveryInventory)
      .values({
        customerId: customer.id,
        customerName: customer.name,
        quantityAllocated: 10000,
        rate: "1000.00",
        allocationCode: `ERP-ALLOC-${suffix}`,
        loadingStatus: "loaded",
      })
      .returning();

    // Cannot release before confirming.
    const early = await deliveryService.releaseAllocation(allocation.id, { actor });
    assert.equal(early.success, false);

    const confirmed = await deliveryService.confirmAllocation(allocation.id, { actor });
    assert.equal(confirmed.success, true);
    assert.equal(confirmed.allocation.releaseStatus, "confirmed");
    assert.ok(confirmed.allocation.confirmedAt, "confirmation timestamped");

    // Confirming twice is a state-machine violation.
    const reconfirm = await deliveryService.confirmAllocation(allocation.id, { actor });
    assert.equal(reconfirm.success, false);

    const released = await deliveryService.releaseAllocation(allocation.id, { actor });
    assert.equal(released.success, true);
    assert.equal(released.allocation.releaseStatus, "released");
    assert.ok(released.allocation.ticketNumber, "ticket assigned on release");
    assert.ok(released.allocation.releasedAt, "release timestamped");

    // Releasing or rejecting after release is refused.
    const again = await deliveryService.releaseAllocation(allocation.id, { actor });
    assert.equal(again.success, false);
    const reject = await deliveryService.rejectAllocation(allocation.id, { actor, reason: "no" });
    assert.equal(reject.success, false);
  });

  test("fleet: directory + append-only expense/income ledger, Django-shaped", async () => {
    const created = await fleetService.createTruck(
      { plateNumber: `ERP-${suffix}`, driverName: "Test Driver", maxCapacity: 45000 },
      { actor }
    );
    assert.equal(created.success, true);
    const truckId = created.truck.id;

    // Duplicate plate rejected.
    const dup = await fleetService.createTruck({ plateNumber: `ERP-${suffix}` }, { actor });
    assert.equal(dup.success, false);

    const fuel = await fleetService.recordLedgerEntry(
      truckId,
      { entryType: "expense", category: "Fuel", amount: 80000, entryDate: "2026-07-26" },
      { actor }
    );
    assert.equal(fuel.success, true);
    assert.equal(fuel.entry.entryType, "expense");

    const revenue = await fleetService.recordLedgerEntry(
      truckId,
      { entryType: "income", category: "Trip Revenue", amount: 250000, entryDate: "2026-07-26" },
      { actor }
    );
    assert.equal(revenue.success, true);

    const { entries, pagination } = await fleetTruckRepo.findLedgerEntries({ truckId });
    assert.equal(pagination.total, 2);
    assert.ok(entries.every((e) => Number(e.amount) > 0));

    const { totals } = await fleetTruckRepo.summarizeLedger({ truckId });
    assert.equal(Number(totals.expenses), 80000);
    assert.equal(Number(totals.income), 250000);

    // Append-only: the repository exposes no update or delete for entries.
    assert.equal(fleetTruckRepo.updateLedgerEntry, undefined);
    assert.equal(fleetTruckRepo.deleteLedgerEntry, undefined);
  });

  test("daily report: duplicate submissions rejected, self-review forbidden", async () => {
    const reportActor = { type: "staff", id: staffRow.id, name: staffRow.email };
    const payload = {
      reportDate: "2026-07-25",
      location: `ERP Test Location ${suffix}`,
      pfiNumber: "PFI-ERP",
      priceBands: [
        { price: 900, litres: 10000 },
        { price: 950, litres: 5000 },
      ],
      amountPaid: 13000000,
      truckCount: 3,
    };

    const submitted = await dailyReportService.submitReport(payload, { actor: reportActor });
    assert.equal(submitted.success, true);
    // Derived scalars: 15000L, value 9000000+4750000=13750000.
    assert.equal(Number(submitted.report.litresSold), 15000);
    assert.equal(Number(submitted.report.totalSalesAmount), 13750000);

    const duplicate = await dailyReportService.submitReport(payload, { actor: reportActor });
    assert.equal(duplicate.success, false);
    assert.equal(duplicate.duplicate, true);

    const selfReview = await dailyReportService.reviewReport(
      submitted.report.id,
      { approve: true },
      { actor: reportActor }
    );
    assert.equal(selfReview.success, false);
    assert.equal(selfReview.forbidden, true);

    const reviewed = await dailyReportService.reviewReport(
      submitted.report.id,
      { approve: true, comment: "Looks right" },
      { actor: { type: "staff", id: null, name: "manager@soroman.test" } }
    );
    assert.equal(reviewed.success, true);
    assert.equal(reviewed.report.status, "approved");

    // An approved report can no longer be amended.
    const amend = await dailyReportService.amendReport(
      submitted.report.id,
      { truckCount: 4 },
      { actor: reportActor }
    );
    assert.equal(amend.success, false);
  });

  test("audit: business events land in the audit trail", async () => {
    // The audit listener is async fire-and-forget; give it a beat.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "delivery.released"));
    assert.ok(rows.length >= 1, "delivery.released was audited");
  });
});
