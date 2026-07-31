const { eq, and, or, ilike, desc, asc, count, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  dangoteDeliveryOrders,
  dangoteDeliveryEvents,
  customers,
  staff,
} = require("../db/schema");

// Legacy admin screens still render paymentStatus / collectionStatus; derive
// them from the status machine until B6 replaces those screens.
const deriveLegacyFields = (row) => {
  if (!row) return row;
  const paid = ["PAID", "SCHEDULED", "DISPATCHED", "COMPLETED"].includes(row.status);
  const collectionStatus =
    row.status === "COMPLETED" ? "Collected" : row.status === "DISPATCHED" ? "Dispatched" : "Pending";
  return { ...row, paymentStatus: paid ? "Paid" : "Unpaid", collectionStatus };
};

const findById = async (id) => {
  const [row] = await db
    .select()
    .from(dangoteDeliveryOrders)
    .where(eq(dangoteDeliveryOrders.id, id))
    .limit(1);
  return row || null;
};

const findByIdFull = async (id) => {
  const [row] = await db
    .select({
      id: dangoteDeliveryOrders.id,
      requestNumber: dangoteDeliveryOrders.requestNumber,
      customerId: dangoteDeliveryOrders.customerId,
      customerName: customers.name,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      companyName: dangoteDeliveryOrders.companyName,
      customerCompanyName: customers.companyName,
      productId: dangoteDeliveryOrders.productId,
      productCode: dangoteDeliveryOrders.productCode,
      product: dangoteDeliveryOrders.productName,
      quantity: dangoteDeliveryOrders.quantity,
      quantityUnit: dangoteDeliveryOrders.quantityUnit,
      deliveryAddress: dangoteDeliveryOrders.deliveryAddress,
      deliveryState: dangoteDeliveryOrders.deliveryState,
      deliveryLga: dangoteDeliveryOrders.deliveryLga,
      contactPerson: dangoteDeliveryOrders.contactPerson,
      contactPhone: dangoteDeliveryOrders.contactPhone,
      status: dangoteDeliveryOrders.status,
      unitPrice: dangoteDeliveryOrders.unitPrice,
      deliveryPrice: dangoteDeliveryOrders.deliveryPrice,
      totalAmount: dangoteDeliveryOrders.totalAmount,
      expectedArrivalDate: dangoteDeliveryOrders.expectedArrivalDate,
      paymentReference: dangoteDeliveryOrders.paymentReference,
      paymentMode: dangoteDeliveryOrders.paymentMode,
      virtualAccountNumber: dangoteDeliveryOrders.virtualAccountNumber,
      virtualAccountBank: dangoteDeliveryOrders.virtualAccountBank,
      virtualAccountName: dangoteDeliveryOrders.virtualAccountName,
      submittedAt: dangoteDeliveryOrders.submittedAt,
      quotedBy: dangoteDeliveryOrders.quotedBy,
      quotedAt: dangoteDeliveryOrders.quotedAt,
      approvedAt: dangoteDeliveryOrders.approvedAt,
      paidAt: dangoteDeliveryOrders.paidAt,
      scheduledAt: dangoteDeliveryOrders.scheduledAt,
      dispatchedAt: dangoteDeliveryOrders.dispatchedAt,
      completedAt: dangoteDeliveryOrders.completedAt,
      cancelledAt: dangoteDeliveryOrders.cancelledAt,
      reviewedBy: dangoteDeliveryOrders.reviewedBy,
      reviewerFirstName: staff.firstName,
      reviewerSurname: staff.surname,
      reviewedAt: dangoteDeliveryOrders.reviewedAt,
      createdAt: dangoteDeliveryOrders.createdAt,
      updatedAt: dangoteDeliveryOrders.updatedAt,
    })
    .from(dangoteDeliveryOrders)
    .leftJoin(customers, eq(dangoteDeliveryOrders.customerId, customers.id))
    .leftJoin(staff, eq(dangoteDeliveryOrders.reviewedBy, staff.id))
    .where(eq(dangoteDeliveryOrders.id, id))
    .limit(1);
  return deriveLegacyFields(row) || null;
};

const findAll = async ({ search, status, customerId, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (status && status !== "all") {
    conditions.push(eq(dangoteDeliveryOrders.status, status));
  }

  if (customerId) {
    conditions.push(eq(dangoteDeliveryOrders.customerId, customerId));
  }

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(dangoteDeliveryOrders.requestNumber, pattern),
        ilike(dangoteDeliveryOrders.productName, pattern),
        ilike(dangoteDeliveryOrders.companyName, pattern),
        ilike(customers.name, pattern)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: dangoteDeliveryOrders.id,
        requestNumber: dangoteDeliveryOrders.requestNumber,
        customerId: dangoteDeliveryOrders.customerId,
        customerName: customers.name,
        customerEmail: customers.email,
        companyName: dangoteDeliveryOrders.companyName,
        productCode: dangoteDeliveryOrders.productCode,
        product: dangoteDeliveryOrders.productName,
        quantity: dangoteDeliveryOrders.quantity,
        quantityUnit: dangoteDeliveryOrders.quantityUnit,
        deliveryAddress: dangoteDeliveryOrders.deliveryAddress,
        deliveryState: dangoteDeliveryOrders.deliveryState,
        status: dangoteDeliveryOrders.status,
        unitPrice: dangoteDeliveryOrders.unitPrice,
        totalAmount: dangoteDeliveryOrders.totalAmount,
        expectedArrivalDate: dangoteDeliveryOrders.expectedArrivalDate,
        virtualAccountNumber: dangoteDeliveryOrders.virtualAccountNumber,
        virtualAccountBank: dangoteDeliveryOrders.virtualAccountBank,
        submittedAt: dangoteDeliveryOrders.submittedAt,
        createdAt: dangoteDeliveryOrders.createdAt,
      })
      .from(dangoteDeliveryOrders)
      .leftJoin(customers, eq(dangoteDeliveryOrders.customerId, customers.id))
      .where(whereClause)
      .orderBy(desc(dangoteDeliveryOrders.createdAt))
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: count() })
      .from(dangoteDeliveryOrders)
      .leftJoin(customers, eq(dangoteDeliveryOrders.customerId, customers.id))
      .where(whereClause),
  ]);

  return {
    requests: rows.map(deriveLegacyFields),
    pagination: {
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    },
  };
};

const create = async (data) => {
  const [row] = await db.insert(dangoteDeliveryOrders).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const updateData = { ...data, updatedAt: new Date() };
  const [row] = await db
    .update(dangoteDeliveryOrders)
    .set(updateData)
    .where(eq(dangoteDeliveryOrders.id, id))
    .returning();
  return row || null;
};

// Chronological timeline for the customer tracker (note carries staff
// send-back reasons).
const findEventsByOrder = async (orderId) => {
  return db
    .select({
      event: dangoteDeliveryEvents.event,
      note: dangoteDeliveryEvents.note,
      at: dangoteDeliveryEvents.createdAt,
    })
    .from(dangoteDeliveryEvents)
    .where(eq(dangoteDeliveryEvents.orderId, orderId))
    .orderBy(asc(dangoteDeliveryEvents.createdAt), asc(dangoteDeliveryEvents.id));
};

// Sequence-backed: concurrency-safe, and the unique index on request_number
// is the backstop. Replaces the racy COUNT(*)+1 generator.
const generateRequestNumber = async () => {
  const result = await db.execute(
    sql`SELECT nextval('dangote_delivery_order_number_seq') AS n`
  );
  const rows = result.rows || result;
  const n = Number(rows[0].n);
  const year = new Date().getFullYear();
  return `DNG-${year}-${String(n).padStart(5, "0")}`;
};

module.exports = {
  findById,
  findByIdFull,
  findAll,
  findEventsByOrder,
  create,
  update,
  generateRequestNumber,
};
