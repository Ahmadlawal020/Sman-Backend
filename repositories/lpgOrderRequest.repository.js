const { eq, and, or, ilike, desc, count, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  lpgOrderRequests,
  customers,
  staff,
  lpgStations,
  lpgStationCylinders,
} = require("../db/schema");

const findById = async (id) => {
  const [row] = await db.select().from(lpgOrderRequests).where(eq(lpgOrderRequests.id, id)).limit(1);
  return row || null;
};

const findByIdFull = async (id) => {
  const [row] = await db
    .select({
      id: lpgOrderRequests.id,
      requestNumber: lpgOrderRequests.requestNumber,
      customerId: lpgOrderRequests.customerId,
      customerName: customers.name,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      companyName: customers.companyName,
      lpgStationId: lpgOrderRequests.lpgStationId,
      stationName: lpgStations.name,
      stationCode: lpgStations.code,
      stationState: lpgStations.state,
      stationCity: lpgStations.city,
      cylinderSizeKg: lpgOrderRequests.cylinderSizeKg,
      cylinderQuantity: lpgOrderRequests.cylinderQuantity,
      deliveryAddress: lpgOrderRequests.deliveryAddress,
      deliveryState: lpgOrderRequests.deliveryState,
      deliveryLga: lpgOrderRequests.deliveryLga,
      status: lpgOrderRequests.status,
      paymentStatus: lpgOrderRequests.paymentStatus,
      collectionStatus: lpgOrderRequests.collectionStatus,
      pricePerKg: lpgOrderRequests.pricePerKg,
      deliveryPrice: lpgOrderRequests.deliveryPrice,
      totalAmount: lpgOrderRequests.totalAmount,
      expectedArrivalDate: lpgOrderRequests.expectedArrivalDate,
      paymentReference: lpgOrderRequests.paymentReference,
      paymentMode: lpgOrderRequests.paymentMode,
      virtualAccountNumber: lpgOrderRequests.virtualAccountNumber,
      virtualAccountBank: lpgOrderRequests.virtualAccountBank,
      virtualAccountName: lpgOrderRequests.virtualAccountName,
      reviewedBy: lpgOrderRequests.reviewedBy,
      reviewerFirstName: staff.firstName,
      reviewerSurname: staff.surname,
      reviewedAt: lpgOrderRequests.reviewedAt,
      createdAt: lpgOrderRequests.createdAt,
      updatedAt: lpgOrderRequests.updatedAt,
    })
    .from(lpgOrderRequests)
    .leftJoin(customers, eq(lpgOrderRequests.customerId, customers.id))
    .leftJoin(lpgStations, eq(lpgOrderRequests.lpgStationId, lpgStations.id))
    .leftJoin(staff, eq(lpgOrderRequests.reviewedBy, staff.id))
    .where(eq(lpgOrderRequests.id, id))
    .limit(1);
  return row || null;
};

const findAll = async ({ search, status, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (status && status !== "all") {
    conditions.push(eq(lpgOrderRequests.status, status));
  }

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(lpgOrderRequests.requestNumber, pattern),
        ilike(customers.name, pattern),
        ilike(lpgStations.name, pattern)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: lpgOrderRequests.id,
        requestNumber: lpgOrderRequests.requestNumber,
        customerId: lpgOrderRequests.customerId,
        customerName: customers.name,
        customerEmail: customers.email,
        lpgStationId: lpgOrderRequests.lpgStationId,
        stationName: lpgStations.name,
        stationState: lpgStations.state,
        cylinderSizeKg: lpgOrderRequests.cylinderSizeKg,
        cylinderQuantity: lpgOrderRequests.cylinderQuantity,
        deliveryAddress: lpgOrderRequests.deliveryAddress,
        deliveryState: lpgOrderRequests.deliveryState,
        deliveryLga: lpgOrderRequests.deliveryLga,
        status: lpgOrderRequests.status,
        paymentStatus: lpgOrderRequests.paymentStatus,
        collectionStatus: lpgOrderRequests.collectionStatus,
        pricePerKg: lpgOrderRequests.pricePerKg,
        totalAmount: lpgOrderRequests.totalAmount,
        expectedArrivalDate: lpgOrderRequests.expectedArrivalDate,
        virtualAccountNumber: lpgOrderRequests.virtualAccountNumber,
        virtualAccountBank: lpgOrderRequests.virtualAccountBank,
        createdAt: lpgOrderRequests.createdAt,
      })
      .from(lpgOrderRequests)
      .leftJoin(customers, eq(lpgOrderRequests.customerId, customers.id))
      .leftJoin(lpgStations, eq(lpgOrderRequests.lpgStationId, lpgStations.id))
      .where(whereClause)
      .orderBy(desc(lpgOrderRequests.createdAt))
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: count() })
      .from(lpgOrderRequests)
      .leftJoin(customers, eq(lpgOrderRequests.customerId, customers.id))
      .leftJoin(lpgStations, eq(lpgOrderRequests.lpgStationId, lpgStations.id))
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
  const [row] = await db.insert(lpgOrderRequests).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const updateData = { ...data, updatedAt: new Date() };
  const [row] = await db
    .update(lpgOrderRequests)
    .set(updateData)
    .where(eq(lpgOrderRequests.id, id))
    .returning();
  return row || null;
};

const generateRequestNumber = async () => {
  const [{ total }] = await db.select({ total: count() }).from(lpgOrderRequests);
  const num = total + 1;
  const year = new Date().getFullYear();
  return `LPG-REQ-${year}-${String(num).padStart(3, "0")}`;
};

const findPayableLpgOrders = async () => {
  return db
    .select({
      id: lpgOrderRequests.id,
      requestNumber: lpgOrderRequests.requestNumber,
      customerId: lpgOrderRequests.customerId,
      customerName: customers.name,
      companyName: customers.companyName,
      customerBalance: customers.balance,
      stationName: lpgStations.name,
      cylinderSizeKg: lpgOrderRequests.cylinderSizeKg,
      cylinderQuantity: lpgOrderRequests.cylinderQuantity,
      totalAmount: lpgOrderRequests.totalAmount,
      paymentStatus: lpgOrderRequests.paymentStatus,
      status: lpgOrderRequests.status,
      createdAt: lpgOrderRequests.createdAt,
      deliveryAddress: lpgOrderRequests.deliveryAddress,
      deliveryState: lpgOrderRequests.deliveryState,
    })
    .from(lpgOrderRequests)
    .innerJoin(customers, eq(lpgOrderRequests.customerId, customers.id))
    .leftJoin(lpgStations, eq(lpgOrderRequests.lpgStationId, lpgStations.id))
    .where(
      and(
        eq(lpgOrderRequests.paymentStatus, "Unpaid"),
        eq(lpgOrderRequests.status, "Approved"),
        sql`${lpgOrderRequests.totalAmount} IS NOT NULL`,
        sql`${lpgOrderRequests.totalAmount} > 0`,
        sql`${customers.balance} >= ${lpgOrderRequests.totalAmount}`
      )
    )
    .orderBy(lpgOrderRequests.createdAt);
};

module.exports = {
  findById,
  findByIdFull,
  findAll,
  create,
  update,
  generateRequestNumber,
  findPayableLpgOrders,
};
