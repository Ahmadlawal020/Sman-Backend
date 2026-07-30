const { eq, and, or, ilike, desc, count } = require("drizzle-orm");
const { db } = require("../config/db");
const { dangoteOrderRequests, customers, staff } = require("../db/schema");

const findById = async (id) => {
  const [row] = await db.select().from(dangoteOrderRequests).where(eq(dangoteOrderRequests.id, id)).limit(1);
  return row || null;
};

const findByIdFull = async (id) => {
  const [row] = await db
    .select({
      id: dangoteOrderRequests.id,
      requestNumber: dangoteOrderRequests.requestNumber,
      customerId: dangoteOrderRequests.customerId,
      customerName: customers.name,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      companyName: customers.companyName,
      product: dangoteOrderRequests.product,
      quantity: dangoteOrderRequests.quantity,
      quantityUnit: dangoteOrderRequests.quantityUnit,
      deliveryAddress: dangoteOrderRequests.deliveryAddress,
      deliveryState: dangoteOrderRequests.deliveryState,
      deliveryLga: dangoteOrderRequests.deliveryLga,
      status: dangoteOrderRequests.status,
      paymentStatus: dangoteOrderRequests.paymentStatus,
      collectionStatus: dangoteOrderRequests.collectionStatus,
      pricePerUnit: dangoteOrderRequests.pricePerUnit,
      deliveryPrice: dangoteOrderRequests.deliveryPrice,
      totalAmount: dangoteOrderRequests.totalAmount,
      expectedArrivalDate: dangoteOrderRequests.expectedArrivalDate,
      paymentReference: dangoteOrderRequests.paymentReference,
      paymentMode: dangoteOrderRequests.paymentMode,
      virtualAccountNumber: dangoteOrderRequests.virtualAccountNumber,
      virtualAccountBank: dangoteOrderRequests.virtualAccountBank,
      virtualAccountName: dangoteOrderRequests.virtualAccountName,
      reviewedBy: dangoteOrderRequests.reviewedBy,
      reviewerFirstName: staff.firstName,
      reviewerSurname: staff.surname,
      reviewedAt: dangoteOrderRequests.reviewedAt,
      createdAt: dangoteOrderRequests.createdAt,
      updatedAt: dangoteOrderRequests.updatedAt,
    })
    .from(dangoteOrderRequests)
    .leftJoin(customers, eq(dangoteOrderRequests.customerId, customers.id))
    .leftJoin(staff, eq(dangoteOrderRequests.reviewedBy, staff.id))
    .where(eq(dangoteOrderRequests.id, id))
    .limit(1);
  return row || null;
};

const findAll = async ({ search, status, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (status && status !== "all") {
    conditions.push(eq(dangoteOrderRequests.status, status));
  }

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(dangoteOrderRequests.requestNumber, pattern),
        ilike(dangoteOrderRequests.product, pattern),
        ilike(customers.name, pattern)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: dangoteOrderRequests.id,
        requestNumber: dangoteOrderRequests.requestNumber,
        customerId: dangoteOrderRequests.customerId,
        customerName: customers.name,
        customerEmail: customers.email,
        product: dangoteOrderRequests.product,
        quantity: dangoteOrderRequests.quantity,
        quantityUnit: dangoteOrderRequests.quantityUnit,
        deliveryAddress: dangoteOrderRequests.deliveryAddress,
        deliveryState: dangoteOrderRequests.deliveryState,
        status: dangoteOrderRequests.status,
        paymentStatus: dangoteOrderRequests.paymentStatus,
        collectionStatus: dangoteOrderRequests.collectionStatus,
        pricePerUnit: dangoteOrderRequests.pricePerUnit,
        totalAmount: dangoteOrderRequests.totalAmount,
        expectedArrivalDate: dangoteOrderRequests.expectedArrivalDate,
        virtualAccountNumber: dangoteOrderRequests.virtualAccountNumber,
        virtualAccountBank: dangoteOrderRequests.virtualAccountBank,
        createdAt: dangoteOrderRequests.createdAt,
      })
      .from(dangoteOrderRequests)
      .leftJoin(customers, eq(dangoteOrderRequests.customerId, customers.id))
      .where(whereClause)
      .orderBy(desc(dangoteOrderRequests.createdAt))
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: count() })
      .from(dangoteOrderRequests)
      .leftJoin(customers, eq(dangoteOrderRequests.customerId, customers.id))
      .where(whereClause),
  ]);

  return {
    requests: rows,
    pagination: {
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    },
  };
};

const create = async (data) => {
  const [row] = await db.insert(dangoteOrderRequests).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const updateData = { ...data, updatedAt: new Date() };
  const [row] = await db
    .update(dangoteOrderRequests)
    .set(updateData)
    .where(eq(dangoteOrderRequests.id, id))
    .returning();
  return row || null;
};

const generateRequestNumber = async () => {
  const [{ total }] = await db.select({ total: count() }).from(dangoteOrderRequests);
  const num = total + 1;
  const year = new Date().getFullYear();
  return `DNG-REQ-${year}-${String(num).padStart(3, "0")}`;
};

module.exports = {
  findById,
  findByIdFull,
  findAll,
  create,
  update,
  generateRequestNumber,
};
