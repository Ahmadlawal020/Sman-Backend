// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { eq, inArray } = require("drizzle-orm");

const { db } = require("../config/db");
const {
  deliveryCustomers,
  deliveryInventory,
  ledgerAccounts,
  ledgerEntries,
  fleetTrucks,
  fleetTrips,
  dailyReports,
  auditEvents,
} = require("../db/schema");
const ledgerService = require("../services/ledger.service");
const deliveryService = require("../services/delivery.service");
const fleetService = require("../services/fleet.service");
const dailyReportService = require("../services/dailyReport.service");
const { ensureTestStaff, closeDb } = require("./helpers");

// In the app this happens in app.js; tests exercising services directly need
// the audit consumer wired the same way.
require("../services/audit.service").registerAuditListener();

const suffix = Date.now().toString(36);
const actor = { type: "staff", id: null, name: "erp-test@soroman.test" };

describe("ERP modules — ledger engine, delivery release, fleet, daily reports", () => {
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
    const accounts = await db
      .select({ id: ledgerAccounts.id })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.ownerId, customer.id));
    const fleetRows = await db
      .select({ id: fleetTrucks.id })
      .from(fleetTrucks)
      .where(eq(fleetTrucks.plateNumber, `ERP-${suffix}`));
    const fleetAccountIds = [];
    for (const row of fleetRows) {
      const accts = await db
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.ownerId, row.id));
      fleetAccountIds.push(...accts.map((a) => a.id));
    }
    const allAccountIds = [...accounts.map((a) => a.id), ...fleetAccountIds];
    if (allAccountIds.length > 0) {
      await db.delete(ledgerEntries).where(inArray(ledgerEntries.accountId, allAccountIds));
      await db.delete(ledgerAccounts).where(inArray(ledgerAccounts.id, allAccountIds));
    }
    await db.delete(fleetTrips).where(inArray(fleetTrips.fleetTruckId, fleetRows.map((r) => r.id)));
    await db.delete(fleetTrucks).where(eq(fleetTrucks.plateNumber, `ERP-${suffix}`));
    await db.delete(deliveryInventory).where(eq(deliveryInventory.customerId, customer.id));
    await db.delete(dailyReports).where(eq(dailyReports.location, `ERP Test Location ${suffix}`));
    await db.delete(deliveryCustomers).where(eq(deliveryCustomers.id, customer.id));
    await closeDb();
  });

  test("ledger: entries are immutable movements and the running balance follows", async () => {
    const sale = await ledgerService.postEntry({
      ownerType: "filling_station",
      ownerId: customer.id,
      ownerName: customer.name,
      direction: "debit",
      category: "sale",
      amount: 500000,
      description: "test purchase",
      actor,
    });
    assert.equal(sale.success, true);
    assert.equal(Number(sale.entry.balanceAfter), 500000);

    const payment = await ledgerService.postEntry({
      ownerType: "filling_station",
      ownerId: customer.id,
      direction: "credit",
      category: "payment",
      amount: 200000,
      reference: `erp-test-payment-${suffix}`,
      actor,
    });
    assert.equal(payment.success, true);
    assert.equal(Number(payment.entry.balanceAfter), 300000);

    // Same reference again: no-op, not a second payment.
    const duplicate = await ledgerService.postEntry({
      ownerType: "filling_station",
      ownerId: customer.id,
      direction: "credit",
      category: "payment",
      amount: 200000,
      reference: `erp-test-payment-${suffix}`,
      actor,
    });
    assert.equal(duplicate.alreadyProcessed, true);

    const account = await ledgerService.getAccount("filling_station", customer.id);
    assert.equal(Number(account.runningBalance), 300000);
    assert.equal(await ledgerService.getDerivedBalance(account.id), 300000);
  });

  test("ledger: concurrent postings serialise; the balance never tears", async () => {
    const results = await Promise.all([
      ledgerService.postEntry({
        ownerType: "filling_station",
        ownerId: customer.id,
        direction: "debit",
        category: "sale",
        amount: 100000,
        actor,
      }),
      ledgerService.postEntry({
        ownerType: "filling_station",
        ownerId: customer.id,
        direction: "credit",
        category: "payment",
        amount: 50000,
        actor,
      }),
    ]);
    assert.equal(results.filter((r) => r.success).length, 2);

    const account = await ledgerService.getAccount("filling_station", customer.id);
    assert.equal(Number(account.runningBalance), 350000);
    assert.equal(await ledgerService.getDerivedBalance(account.id), 350000);
  });

  test("delivery release workflow posts the sale exactly once", async () => {
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

    const before = await ledgerService.getStatement({
      ownerType: "delivery_customer",
      ownerId: customer.id,
    });

    const released = await deliveryService.releaseAllocation(allocation.id, { actor });
    assert.equal(released.success, true);
    assert.equal(released.allocation.releaseStatus, "released");
    assert.ok(released.allocation.ticketNumber, "ticket assigned on release");
    assert.ok(released.ledgerEntry, "sale posted to the delivery ledger");
    assert.equal(Number(released.ledgerEntry.amount), 10000 * 1000);

    // Releasing again is a state-machine violation, not a second sale.
    const again = await deliveryService.releaseAllocation(allocation.id, { actor });
    assert.equal(again.success, false);

    const afterStatement = await ledgerService.getStatement({
      ownerType: "delivery_customer",
      ownerId: customer.id,
    });
    assert.equal(
      afterStatement.pagination.total,
      before.pagination.total + 1,
      "exactly one ledger entry from the release"
    );
  });

  test("fleet: financial movements land in the truck's ledger, not on the truck", async () => {
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
      { category: "fuel", amount: 80000, description: "Diesel top-up" },
      { actor }
    );
    assert.equal(fuel.success, true);

    const income = await fleetService.recordLedgerEntry(
      truckId,
      { category: "income", amount: 250000, description: "Trip revenue" },
      { actor }
    );
    assert.equal(income.success, true);

    const statement = await fleetService.getStatement(truckId);
    // Net cost = expenses - income = 80000 - 250000 = -170000 (earning truck).
    assert.equal(Number(statement.account.runningBalance), -170000);

    const trip = await fleetService.recordTrip(
      truckId,
      { tripDate: "2026-07-26", mileageStart: 1000, mileageEnd: 1450, fuelUsedLitres: 300 },
      { actor }
    );
    assert.equal(trip.success, true);

    const truckAfter = await require("../repositories").fleetTruckRepo.findById(truckId);
    assert.equal(truckAfter.mileage, 1450, "odometer advanced by the trip");
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
    // Derived scalars: 15000L, value 9000000+4750000=13750000, avg 916.67.
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
