const { eq, and, or, ilike, desc, count, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { tickets, orders, customers, depots, products, admins } = require("../db/schema");

const findById = async (id) => {
  const [row] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  return row || null;
};

const findByNumber = async (ticketNumber) => {
  const [row] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.ticketNumber, ticketNumber))
    .limit(1);
  return row || null;
};

const findByIdOrCode = async (idOrCode) => {
  // Try as UUID first, then as ticket number
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);

  if (isUuid) {
    return findById(idOrCode);
  }
  return findByNumber(idOrCode);
};

const findByIdFull = async (id) => {
  const [row] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      orderId: tickets.orderId,
      status: tickets.status,
      qrCodeDataUrl: tickets.qrCodeDataUrl,
      redeemedAt: tickets.redeemedAt,
      redeemedBy: tickets.redeemedBy,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      orderNumber: orders.orderNumber,
      orderStatus: orders.orderStatus,
      orderQuantity: orders.quantity,
      orderPrice: orders.price,
      orderTotalAmount: orders.totalAmount,
      orderDeliveryType: orders.deliveryType,
      orderState: orders.state,
      orderCreatedAt: orders.createdAt,
      customerName: customers.name,
      customerEmail: customers.email,
      customerPhone: customers.phone,
      customerCompanyName: customers.companyName,
      depotName: depots.name,
      depotCode: depots.code,
      depotAddress: depots.address,
      productName: products.name,
      productSku: products.sku,
      productUnit: products.unit,
      redeemerFirstName: admins.firstName,
      redeemerSurname: admins.surname,
      redeemerEmail: admins.email,
    })
    .from(tickets)
    .leftJoin(orders, eq(tickets.orderId, orders.id))
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(depots, eq(orders.depotId, depots.id))
    .leftJoin(products, eq(orders.productId, products.id))
    .leftJoin(admins, eq(tickets.redeemedBy, admins.id))
    .where(eq(tickets.id, id))
    .limit(1);
  return row || null;
};

const findByIdOrCodeFull = async (idOrCode) => {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);

  if (isUuid) {
    return findByIdFull(idOrCode);
  }

  // Find by ticket number then get full details
  const ticket = await findByNumber(idOrCode);
  if (!ticket) return null;
  return findByIdFull(ticket.id);
};

const findByOrder = async (orderId) => {
  const [row] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.orderId, orderId))
    .limit(1);
  return row || null;
};

const findAll = async ({ search, status, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (status) {
    conditions.push(eq(tickets.status, status));
  }

  if (search) {
    conditions.push(ilike(tickets.ticketNumber, `%${search}%`));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        orderId: tickets.orderId,
        status: tickets.status,
        qrCodeDataUrl: tickets.qrCodeDataUrl,
        redeemedAt: tickets.redeemedAt,
        redeemedBy: tickets.redeemedBy,
        createdAt: tickets.createdAt,
        updatedAt: tickets.updatedAt,
        orderNumber: orders.orderNumber,
        customerName: customers.name,
        productName: products.name,
        depotName: depots.name,
        redeemerFirstName: admins.firstName,
        redeemerSurname: admins.surname,
      })
      .from(tickets)
      .leftJoin(orders, eq(tickets.orderId, orders.id))
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .leftJoin(depots, eq(orders.depotId, depots.id))
      .leftJoin(products, eq(orders.productId, products.id))
      .leftJoin(admins, eq(tickets.redeemedBy, admins.id))
      .where(whereClause)
      .orderBy(desc(tickets.createdAt))
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: count() })
      .from(tickets)
      .where(whereClause),
  ]);

  return {
    tickets: rows,
    pagination: {
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    },
  };
};

const create = async (data) => {
  const [row] = await db.insert(tickets).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const [row] = await db
    .update(tickets)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(tickets.id, id))
    .returning();
  return row || null;
};

module.exports = {
  findById,
  findByNumber,
  findByIdOrCode,
  findByIdFull,
  findByIdOrCodeFull,
  findByOrder,
  findAll,
  create,
  update,
};
