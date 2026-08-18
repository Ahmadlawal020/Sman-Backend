const { eq, and, or, ilike, desc, gt, isNull, count } = require("drizzle-orm");
const { db } = require("../config/db");
const { administrationUser, staffPasswordResets } = require("../db/schema");
const { verifyDjangoPassword, hashDjangoPassword } = require("../utils/djangoPassword");

/**
 * administration_user is Django's real staff table (soroman_db, public
 * schema) — see docs/LIVE_DB_CUTOVER.md §6.7. Column differences from the old
 * clean-room `staff` table this replaces:
 *
 *  - No firstName/surname split — just `fullName`.
 *  - No isPasswordSet — Django users always have a password hash.
 *  - No passwordResetToken/Expires column at all — moved to
 *    sman.staff_password_resets (docs/LIVE_DB_CUTOVER.md §4), since Django's
 *    schema has nowhere to store one.
 *  - No profilePictureUrl/profilePicturePublicId — just `photo` (Django
 *    ImageField, an upload path, not a full Cloudinary URL+publicId pair).
 *  - `roles` is integer[] (Roles.choices in soroman_backend-2/administration/
 *    models.py), not text[] of role-name strings.
 */

const findById = async (id) => {
  const numericId = parseInt(id, 10);
  const targetId = isNaN(numericId) ? id : numericId;
  const [row] = await db.select().from(administrationUser).where(eq(administrationUser.id, targetId)).limit(1);
  return row || null;
};

const findByEmail = async (email) => {
  const [row] = await db
    .select()
    .from(administrationUser)
    .where(eq(administrationUser.email, email.toLowerCase()))
    .limit(1);
  return row || null;
};

/**
 * Looks up the staff member for a live, unconsumed reset token. Callers pass
 * the SHA-256 of the raw token, same as before — only the storage location
 * changed (sman.staff_password_resets, not a column on administration_user).
 */
const findByPasswordResetToken = async (hashedToken) => {
  const [resetRow] = await db
    .select()
    .from(staffPasswordResets)
    .where(
      and(
        eq(staffPasswordResets.tokenHash, hashedToken),
        gt(staffPasswordResets.expiresAt, new Date()),
        isNull(staffPasswordResets.consumedAt)
      )
    )
    .limit(1);
  if (!resetRow) return null;
  return findById(resetRow.staffId);
};

const findAll = async ({ search, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(ilike(administrationUser.fullName, pattern), ilike(administrationUser.email, pattern)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(administrationUser)
      .where(whereClause)
      .orderBy(desc(administrationUser.dateJoined))
      .limit(limitNum)
      .offset(offset),
    db.select({ total: count() }).from(administrationUser).where(whereClause),
  ]);

  return {
    staff: rows,
    pagination: {
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    },
  };
};

const create = async (data) => {
  const insertData = { ...data };
  if (insertData.password) {
    insertData.password = await hashDjangoPassword(insertData.password);
  }
  if (insertData.email) {
    insertData.email = insertData.email.toLowerCase();
  }
  const [row] = await db.insert(administrationUser).values(insertData).returning();
  return row;
};

const update = async (id, data) => {
  const updateData = { ...data };
  if (updateData.password) {
    updateData.password = await hashDjangoPassword(updateData.password);
  }
  if (updateData.email) {
    updateData.email = updateData.email.toLowerCase();
  }
  const [row] = await db.update(administrationUser).set(updateData).where(eq(administrationUser.id, id)).returning();
  return row || null;
};

// Deletes the actual Django staff account. Kept for API compatibility with
// the old repository, but this removes a real administration_user row that
// Django's own admin and auth also depend on — worth confirming this is
// still wanted before it's wired into a route.
const deleteById = async (id) => {
  const [row] = await db.delete(administrationUser).where(eq(administrationUser.id, id)).returning();
  return row || null;
};

const comparePassword = async (staffMember, candidatePassword) => {
  if (!staffMember.password) return false;
  return verifyDjangoPassword(candidatePassword, staffMember.password);
};

module.exports = {
  findById,
  findByEmail,
  findByPasswordResetToken,
  findAll,
  create,
  update,
  deleteById,
  comparePassword,
};
