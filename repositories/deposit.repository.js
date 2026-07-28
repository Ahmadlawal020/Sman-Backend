const { eq, and, or, ilike, desc, count, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { deposits, customers, staff } = require("../db/schema");

const findById = async (id) => {
  const [row] = await db.select().from(deposits).where(eq(deposits.id, id)).limit(1);
  return row || null;
};

const findByIdFull = async (id) => {
  const [row] = await db
    .select({
      id: deposits.id,
      customerId: deposits.customerId,
      amount: deposits.amount,
      type: deposits.type,
      description: deposits.description,
      reference: deposits.reference,
      recordedBy: deposits.recordedBy,
      balanceAfter: deposits.balanceAfter,
      paystackDetails: deposits.paystackDetails,
      createdAt: deposits.createdAt,
      updatedAt: deposits.updatedAt,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerCompanyName: customers.companyName,
      recorderFirstName: staff.firstName,
      recorderSurname: staff.surname,
      recorderEmail: staff.email,
    })
    .from(deposits)
    .leftJoin(customers, eq(deposits.customerId, customers.id))
    .leftJoin(staff, eq(deposits.recordedBy, staff.id))
    .where(eq(deposits.id, id))
    .limit(1);
  return row || null;
};

const findByReference = async (reference) => {
  const [row] = await db
    .select()
    .from(deposits)
    .where(eq(deposits.reference, reference))
    .limit(1);
  return row || null;
};

const findAll = async ({ customer, page = 1, limit = 50, type = "credit" } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(5000, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (customer) conditions.push(eq(deposits.customerId, customer));
  if (type) conditions.push(eq(deposits.type, type));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: deposits.id,
        customerId: deposits.customerId,
        amount: deposits.amount,
        type: deposits.type,
        description: deposits.description,
        reference: deposits.reference,
        recordedBy: deposits.recordedBy,
        balanceAfter: deposits.balanceAfter,
        paystackDetails: deposits.paystackDetails,
        createdAt: deposits.createdAt,
        updatedAt: deposits.updatedAt,
        customerName: customers.name,
        customerPhone: customers.phone,
        customerCompanyName: customers.companyName,
        recorderFirstName: staff.firstName,
        recorderSurname: staff.surname,
      })
      .from(deposits)
      .leftJoin(customers, eq(deposits.customerId, customers.id))
      .leftJoin(staff, eq(deposits.recordedBy, staff.id))
      .where(whereClause)
      .orderBy(desc(deposits.createdAt))
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: count() })
      .from(deposits)
      .where(whereClause),
  ]);

  return {
    deposits: rows,
    pagination: {
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    },
  };
};

const create = async (data, tx = db) => {
  const [row] = await tx.insert(deposits).values(data).returning();
  return row;
};

const countByCustomer = async (customerId) => {
  const [{ total }] = await db
    .select({ total: count() })
    .from(deposits)
    .where(eq(deposits.customerId, customerId));
  return total;
};

module.exports = {
  findById,
  findByIdFull,
  findByReference,
  findAll,
  create,
  countByCustomer,
};
