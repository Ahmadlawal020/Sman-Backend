const { eq } = require("drizzle-orm");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../config/db");
const { offlineSales, offlineSaleItems } = require("../db/schema");
const { offlineSaleRepo, productRepo } = require("../repositories");
const { emitEvent } = require("./events");

// An offline sale and its line items are one fact: they are written in a
// single transaction, and the header total is computed from the lines inside
// that transaction — the two can never disagree. Unit prices are snapshots
// keyed in by staff (offline sales happen where the price list isn't live);
// approval is the control that reviews them.

const money = (value) => Number(value || 0);
const asDecimal = (value) => money(value).toFixed(2);

const createSale = async ({ items, ...header }, { actor }) => {
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

  const saleNumber = `OFS-${uuidv4().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

  const sale = await db.transaction(async (tx) => {
    let total = 0;
    const lines = items.map((item) => {
      const lineTotal = money(item.unitPrice) * item.quantity;
      total += lineTotal;
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: asDecimal(item.unitPrice),
        lineTotal: asDecimal(lineTotal),
      };
    });

    const [created] = await tx
      .insert(offlineSales)
      .values({
        ...header,
        saleNumber,
        totalAmount: asDecimal(total),
        status: "pending",
        createdBy: actor?.id || null,
        createdByName: actor?.name || "",
      })
      .returning();

    await tx
      .insert(offlineSaleItems)
      .values(lines.map((line) => ({ ...line, offlineSaleId: created.id })));

    return created;
  });

  emitEvent("offline_sale.created", {
    actor,
    entityType: "offline_sale",
    entityId: sale.id,
    saleNumber,
    totalAmount: sale.totalAmount,
  });

  return { success: true, sale: await offlineSaleRepo.findByIdWithItems(sale.id) };
};

const recordPayment = async (id, { amount, bank = "", reference = "" }, { actor }) => {
  const value = money(amount);
  if (value <= 0) return { success: false, message: "Payment amount must be positive" };

  // Locked read-modify-write: two clerks recording payments at once must not
  // lose each other's amounts.
  const result = await db.transaction(async (tx) => {
    const [sale] = await tx
      .select()
      .from(offlineSales)
      .where(eq(offlineSales.id, id))
      .for("update")
      .limit(1);
    if (!sale) return { success: false, notFound: true, message: "Offline sale not found" };
    if (sale.status === "rejected") {
      return { success: false, message: "Cannot record payment on a rejected sale" };
    }

    const amountPaid = money(sale.amountPaid) + value;
    const [updated] = await tx
      .update(offlineSales)
      .set({
        amountPaid: asDecimal(amountPaid),
        paymentStatus: amountPaid >= money(sale.totalAmount) ? "Paid" : "Unpaid",
        paymentBank: bank || sale.paymentBank,
        paymentReference: reference || sale.paymentReference,
        updatedAt: new Date(),
      })
      .where(eq(offlineSales.id, id))
      .returning();

    return { success: true, sale: updated };
  });

  if (result.success) {
    emitEvent("offline_sale.payment_recorded", {
      actor,
      entityType: "offline_sale",
      entityId: id,
      amount: asDecimal(value),
      bank,
    });
  }

  return result;
};

const reviewSale = async (id, { approve, reason = "" }, { actor }) => {
  const sale = await offlineSaleRepo.findById(id);
  if (!sale) return { success: false, notFound: true, message: "Offline sale not found" };
  if (sale.status !== "pending") {
    return { success: false, message: `Sale is already ${sale.status}` };
  }

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
    saleNumber: sale.saleNumber,
    reason,
    // For the notification consumer: who keyed the sale in, and for how much.
    createdBy: sale.createdBy || null,
    totalAmount: sale.totalAmount,
  });

  return { success: true, sale: updated };
};

/**
 * Reconciliation: an approved, fully-paid sale is marked as matched against
 * the bank/deposit records. One-way.
 */
const reconcileSale = async (id, { actor }) => {
  const sale = await offlineSaleRepo.findById(id);
  if (!sale) return { success: false, notFound: true, message: "Offline sale not found" };
  if (sale.status !== "approved") {
    return { success: false, message: "Only approved sales can be reconciled" };
  }
  if (sale.paymentStatus !== "Paid") {
    return { success: false, message: "Sale is not fully paid — record the payment first" };
  }
  if (sale.reconciled) {
    return { success: false, message: "Sale is already reconciled" };
  }

  const updated = await offlineSaleRepo.update(id, {
    reconciled: true,
    reconciledBy: actor?.id || null,
    reconciledAt: new Date(),
  });

  emitEvent("offline_sale.reconciled", {
    actor,
    entityType: "offline_sale",
    entityId: id,
    saleNumber: sale.saleNumber,
  });

  return { success: true, sale: updated };
};

module.exports = { createSale, recordPayment, reviewSale, reconcileSale };
