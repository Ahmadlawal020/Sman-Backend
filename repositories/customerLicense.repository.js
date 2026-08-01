const { eq, and, or, ilike, gte, desc, count, sql } = require("drizzle-orm");
const { db } = require("../config/db");
const { customerLicenses, customers, staff } = require("../db/schema");

const findById = async (id) => {
  const [row] = await db
    .select()
    .from(customerLicenses)
    .where(eq(customerLicenses.id, id))
    .limit(1);
  return row || null;
};

const findByIdWithCustomer = async (id) => {
  const [row] = await db
    .select({
      id: customerLicenses.id,
      customerId: customerLicenses.customerId,
      customerName: customers.name,
      customerEmail: customers.email,
      companyName: customerLicenses.companyName,
      companyNameNormalized: customerLicenses.companyNameNormalized,
      fileName: customerLicenses.fileName,
      fileSize: customerLicenses.fileSize,
      mimeType: customerLicenses.mimeType,
      status: customerLicenses.status,
      expiryDate: customerLicenses.expiryDate,
      verifiedBy: customerLicenses.verifiedBy,
      verifierFirstName: staff.firstName,
      verifierSurname: staff.surname,
      verifiedAt: customerLicenses.verifiedAt,
      verificationComment: customerLicenses.verificationComment,
      createdAt: customerLicenses.createdAt,
      updatedAt: customerLicenses.updatedAt,
    })
    .from(customerLicenses)
    .leftJoin(customers, eq(customerLicenses.customerId, customers.id))
    .leftJoin(staff, eq(customerLicenses.verifiedBy, staff.id))
    .where(eq(customerLicenses.id, id))
    .limit(1);
  return row || null;
};

const findByCustomer = async (customerId) => {
  return db
    .select()
    .from(customerLicenses)
    .where(eq(customerLicenses.customerId, customerId))
    .orderBy(desc(customerLicenses.createdAt));
};

// The reuse offer: a customer's VERIFIED, unexpired license for a company.
const findReusable = async (customerId, companyNameNormalized) => {
  if (!companyNameNormalized) return null;
  const [row] = await db
    .select()
    .from(customerLicenses)
    .where(
      and(
        eq(customerLicenses.customerId, customerId),
        eq(customerLicenses.companyNameNormalized, companyNameNormalized),
        eq(customerLicenses.status, "VERIFIED"),
        gte(customerLicenses.expiryDate, sql`CURRENT_DATE`)
      )
    )
    .orderBy(desc(customerLicenses.verifiedAt))
    .limit(1);
  return row || null;
};

// Staff registry: one filterable list across all customers.
const findAll = async ({ search, status, customerId, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (status && status !== "all") conditions.push(eq(customerLicenses.status, status));
  if (customerId) conditions.push(eq(customerLicenses.customerId, customerId));
  if (search) {
    const p = `%${search}%`;
    conditions.push(or(ilike(customerLicenses.companyName, p), ilike(customers.name, p)));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: customerLicenses.id,
        customerId: customerLicenses.customerId,
        customerName: customers.name,
        companyName: customerLicenses.companyName,
        fileName: customerLicenses.fileName,
        mimeType: customerLicenses.mimeType,
        status: customerLicenses.status,
        expiryDate: customerLicenses.expiryDate,
        verifiedAt: customerLicenses.verifiedAt,
        createdAt: customerLicenses.createdAt,
      })
      .from(customerLicenses)
      .leftJoin(customers, eq(customerLicenses.customerId, customers.id))
      .where(where)
      .orderBy(desc(customerLicenses.createdAt))
      .limit(limitNum)
      .offset(offset),
    db
      .select({ total: count() })
      .from(customerLicenses)
      .leftJoin(customers, eq(customerLicenses.customerId, customers.id))
      .where(where),
  ]);

  return { licenses: rows, pagination: { total, page: pageNum, pages: Math.ceil(total / limitNum) } };
};

const create = async (data) => {
  const [row] = await db.insert(customerLicenses).values(data).returning();
  return row;
};

const update = async (id, data) => {
  const [row] = await db
    .update(customerLicenses)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(customerLicenses.id, id))
    .returning();
  return row || null;
};

const deleteById = async (id) => {
  const [row] = await db
    .delete(customerLicenses)
    .where(eq(customerLicenses.id, id))
    .returning();
  return row || null;
};

module.exports = {
  findById,
  findByIdWithCustomer,
  findByCustomer,
  findReusable,
  findAll,
  create,
  update,
  deleteById,
};
