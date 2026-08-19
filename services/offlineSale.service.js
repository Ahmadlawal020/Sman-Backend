const { db } = require("../config/db");
const { administrationOfflinesales, administrationOfflinesalesproduct } = require("../db/schema");
const { offlineSaleRepo, productRepo } = require("../repositories");
const { emitEvent } = require("./events");

/**
 * administration_offlinesales (live, canonical) is much sparser than the old
 * clean-room offline_sales table this replaces — see
 * repositories/offlineSale.repository.js's header comment for the full
 * list. No saleNumber, createdBy/createdByName pair (just a plain `staff`
 * name string), amountPaid, paymentStatus/Bank/Reference, approvedBy/
 * approvedAt/rejectionReason, or reconciled/reconciledBy/reconciledAt
 * column exists at all — only id/staff/status/totalPrice/notes/stateId/
 * createdAt/updatedAt. Per-line unitPrice/lineTotal are dropped for the
 * same reason (administration_offlinesalesproduct tracks quantity only);
 * the header's totalPrice is the only money figure that survives.
 */

const money = (value) => Number(value || 0);
const asDecimal = (value) => money(value).toFixed(2);

/** Customer/staff-facing reference — computed like order/ticket references, since there's no sale_number column to store one in. */
const saleReference = (id) => `OFS-${id}`;

const createSale = async ({ items, notes, stateId }, { actor }) => {
  if (!Array.isArray(items) || items.length === 0) {
    return { success: false, message: "An offline sale needs at least one line item" };
  }

  // Validate products exist before opening the transaction.
  for (const item of items) {
    const product = await productRepo.findById(item.productId);
    if (!product) {
      return { success: false, message: `Product ${item.productId} not found` };
    }
  }

  const sale = await db.transaction(async (tx) => {
    let total = 0;
    const lines = items.map((item) => {
      total += money(item.unitPrice) * item.quantity;
      return { productId: item.productId, quantity: item.quantity };
    });

    const now = new Date().toISOString();
    const [created] = await tx
      .insert(administrationOfflinesales)
      .values({
        staff: actor?.name || "",
        status: "pending",
        totalPrice: asDecimal(total),
        notes: notes || null,
        stateId: stateId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await tx
      .insert(administrationOfflinesalesproduct)
      .values(lines.map((line) => ({ ...line, offlineId: created.id })));

    return created;
  });

  const saleNumber = saleReference(sale.id);

  emitEvent("offline_sale.created", {
    actor,
    entityType: "offline_sale",
    entityId: sale.id,
    saleNumber,
    totalAmount: sale.totalPrice,
  });

  return { success: true, sale: await offlineSaleRepo.findByIdWithItems(sale.id) };
};

/**
 * FLAGGED — no live column tracks a partial-payment amount, a payment
 * status, or the paying bank/reference at all (see this file's header
 * comment). Writing them would silently vanish (drizzle drops unknown keys
 * from a .set()), leaving the caller believing a payment was recorded when
 * nothing durable happened — worse than refusing outright. Needs a human
 * decision (most likely a small sman-owned extras table, the same pattern
 * used for depot/lpgStation/dailyReport/truck — see db/schema/sman/) before
 * this can work again; not invented here.
 */
const recordPayment = async (id, { amount }) => {
  const value = money(amount);
  if (value <= 0) return { success: false, message: "Payment amount must be positive" };

  const sale = await offlineSaleRepo.findById(id);
  if (!sale) return { success: false, notFound: true, message: "Offline sale not found" };

  return {
    success: false,
    message:
      "Payment recording against offline sales isn't available yet on this schema — administration_offlinesales has no amount-paid/payment-status columns to persist it to.",
  };
};

const reviewSale = async (id, { approve, reason = "" }, { actor }) => {
  const sale = await offlineSaleRepo.findById(id);
  if (!sale) return { success: false, notFound: true, message: "Offline sale not found" };
  if (sale.status !== "pending") {
    return { success: false, message: `Sale is already ${sale.status}` };
  }

  // approvedBy/approvedAt/rejectionReason have no live column either — only
  // `status` actually persists here (offlineSaleRepo.update's raw .set()
  // silently drops the rest, same as findAll's dropped `reconciled` filter,
  // see repositories/offlineSale.repository.js's header comment). Passed
  // through anyway so a future extras table (see recordPayment's note above)
  // can pick them up without a second pass through every call site.
  const status = approve ? "approved" : "rejected";
  const updated = await offlineSaleRepo.update(id, {
    status,
    approvedBy: actor?.id || null,
    approvedAt: new Date(),
    rejectionReason: approve ? "" : reason,
  });

  emitEvent(`offline_sale.${status}`, {
    actor,
    entityType: "offline_sale",
    entityId: id,
    saleNumber: saleReference(sale.id),
    reason,
    createdBy: null,
    totalAmount: sale.totalPrice,
  });

  return { success: true, sale: updated };
};

/**
 * FLAGGED — same gap as recordPayment: no reconciled/reconciledBy/
 * reconciledAt or paymentStatus column exists live, so there is nothing
 * true to check ("fully paid" can never be determined) or persist. Refusing
 * outright rather than silently no-opping while reporting success.
 */
const reconcileSale = async (id, { actor }) => {
  const sale = await offlineSaleRepo.findById(id);
  if (!sale) return { success: false, notFound: true, message: "Offline sale not found" };
  if (sale.status !== "approved") {
    return { success: false, message: "Only approved sales can be reconciled" };
  }

  return {
    success: false,
    message:
      "Reconciliation isn't available yet on this schema — administration_offlinesales has no payment-status or reconciled columns to check or persist it to.",
  };
};

module.exports = { createSale, recordPayment, reviewSale, reconcileSale };
