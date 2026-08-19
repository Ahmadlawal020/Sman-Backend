const { eq, and, or, ilike, desc, count } = require("drizzle-orm");
const { db } = require("../config/db");
const { consumerTruckticket, consumerOrder, consumerOrderproduct, consumerCustomer, consumerProduct, consumerPfi, administrationUser } = require("../db/schema");
const { generateOrderReference } = require("../utils/helpers");

/**
 * consumer_truckticket is Django's real ticket table — see
 * soroman_backend-2/consumer/models.py:1796 ("standalone truck ticket
 * created after an order is released... generated explicitly via the
 * generate-tickets endpoint"), the equivalent of the old `tickets` table.
 * Gaps from the old table, none silently stubbed:
 *
 *  - No qrCodeDataUrl column at all — QR generation has no live backing.
 *  - No redeemedAt/redeemedBy as such. The closest live concept is security
 *    gate entry (enteredAt/enteredById) — TICKET_STATUS_CHOICES is
 *    pending/generated/printed/loaded/completed, nothing called "redeemed".
 *    Mapped below as the nearest equivalent, not an exact synonym.
 *  - orderTruckId doesn't exist — a ticket links to the order directly
 *    (order_id), not to a specific consumer_truckallocation row.
 */

const formatTicket = (row) => {
  if (!row) return null;
  const { orderCompanyName, orderStatus, orderQuantity, orderTotalPrice, orderReleaseType, orderStateName, orderCreatedAt, customerName, customerLastName, customerEmail, customerPhone, customerCompanyName, productName, productUnit, pfiNumber, enteredByFullName, enteredByEmail, ...ticket } = row;

  const company = orderCompanyName || customerCompanyName || "";
  const ref = ticket.orderId ? generateOrderReference(company, ticket.orderId) : null;

  return {
    ...ticket,
    order: ticket.orderId
      ? {
          id: ticket.orderId,
          orderNumber: ref,
          reference: ref,
          status: orderStatus,
          quantity: orderQuantity,
          totalPrice: orderTotalPrice,
          releaseType: orderReleaseType,
          state: orderStateName,
          pfiNumber: pfiNumber || "",
          createdAt: orderCreatedAt,
          product: productName ? { name: productName, unit: productUnit || "Liters" } : null,
          customer: customerName ? { name: `${customerName} ${customerLastName || ""}`.trim(), email: customerEmail || "", phone: customerPhone || "", companyName: customerCompanyName || "" } : null,
        }
      : null,
    enteredBy: enteredByFullName ? { fullName: enteredByFullName, email: enteredByEmail || "" } : null,
  };
};

const findById = async (id) => {
  const [row] = await db.select().from(consumerTruckticket).where(eq(consumerTruckticket.id, id)).limit(1);
  return row || null;
};

/** No stored ticket_number live — TruckTicket has no equivalent code column, only order_id + truck_number. */
const findByOrderAndTruckNumber = async (orderId, truckNumber, tx = db) => {
  const [row] = await tx
    .select()
    .from(consumerTruckticket)
    .where(and(eq(consumerTruckticket.orderId, orderId), eq(consumerTruckticket.truckNumber, truckNumber)))
    .limit(1);
  return row || null;
};

const findByIdOrCode = async (idOrCode) => {
  if (!idOrCode) return null;
  const str = String(idOrCode);
  if (/^\d+$/.test(str)) return findById(parseInt(str, 10));
  return null;
};

const FULL_TICKET_COLUMNS = {
  ...consumerTruckticket,
  orderCompanyName: consumerOrder.customerName,
  orderStatus: consumerOrder.status,
  orderQuantity: consumerOrder.quantity,
  orderTotalPrice: consumerOrder.totalPrice,
  orderReleaseType: consumerOrder.releaseType,
  orderCreatedAt: consumerOrder.createdAt,
  customerName: consumerCustomer.firstName,
  customerLastName: consumerCustomer.lastName,
  customerEmail: consumerCustomer.email,
  customerPhone: consumerCustomer.phoneNumber,
  customerCompanyName: consumerCustomer.companyName,
  productName: consumerProduct.name,
  productUnit: consumerProduct.unit,
  pfiNumber: consumerPfi.pfiNumber,
  enteredByFullName: administrationUser.fullName,
  enteredByEmail: administrationUser.email,
};

const fullTicketQuery = () =>
  db
    .select(FULL_TICKET_COLUMNS)
    .from(consumerTruckticket)
    .leftJoin(consumerOrder, eq(consumerTruckticket.orderId, consumerOrder.id))
    .leftJoin(consumerCustomer, eq(consumerOrder.userId, consumerCustomer.id))
    .leftJoin(consumerOrderproduct, eq(consumerOrderproduct.orderId, consumerOrder.id))
    .leftJoin(consumerProduct, eq(consumerOrderproduct.productId, consumerProduct.id))
    .leftJoin(consumerPfi, eq(consumerOrder.pfiId, consumerPfi.id))
    .leftJoin(administrationUser, eq(consumerTruckticket.enteredById, administrationUser.id));

const findByIdFull = async (id) => {
  const [row] = await fullTicketQuery().where(eq(consumerTruckticket.id, id)).limit(1);
  return formatTicket(row);
};

const findByIdOrCodeFull = async (idOrCode) => {
  if (!idOrCode) return null;
  const str = String(idOrCode);
  if (/^\d+$/.test(str)) return findByIdFull(parseInt(str, 10));
  return null;
};

const findByOrder = async (orderId, tx = db) => {
  return tx.select().from(consumerTruckticket).where(eq(consumerTruckticket.orderId, orderId));
};

const findAll = async ({ search, status, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (status) conditions.push(eq(consumerTruckticket.ticketStatus, status));
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(ilike(consumerTruckticket.plateNumber, pattern), ilike(consumerTruckticket.driverName, pattern), ilike(consumerCustomer.firstName, pattern)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    fullTicketQuery().where(whereClause).orderBy(desc(consumerTruckticket.createdAt)).limit(limitNum).offset(offset),
    db
      .select({ total: count() })
      .from(consumerTruckticket)
      .leftJoin(consumerOrder, eq(consumerTruckticket.orderId, consumerOrder.id))
      .leftJoin(consumerCustomer, eq(consumerOrder.userId, consumerCustomer.id))
      .where(whereClause),
  ]);

  return {
    tickets: rows.map(formatTicket),
    pagination: { total: Number(total), page: pageNum, pages: Math.ceil(Number(total) / limitNum) },
  };
};

const create = async (data, tx = db) => {
  const [row] = await tx.insert(consumerTruckticket).values(data).returning();
  return row;
};

const update = async (id, data, tx = db) => {
  const [row] = await tx
    .update(consumerTruckticket)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(consumerTruckticket.id, id))
    .returning();
  return row || null;
};

module.exports = {
  findById,
  findByOrderAndTruckNumber,
  findByIdOrCode,
  findByIdFull,
  findByIdOrCodeFull,
  findByOrder,
  findAll,
  create,
  update,
};
