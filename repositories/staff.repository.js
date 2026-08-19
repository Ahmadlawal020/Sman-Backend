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

/**
 * Translates the old clean-room caller shape into administration_user's
 * columns. Every existing creation path (staff.controller, tests/helpers)
 * still sends firstName/surname/isPasswordSet/passwordResetToken — none of
 * which exist on the live table (see the header above). Drizzle silently
 * drops unknown keys, so without this the insert dies on the fullName /
 * password NOT NULL constraints instead.
 *
 *  - firstName/otherNames/surname collapse into fullName.
 *  - roles may arrive as Sman strings (["admin"]) or Django ints ([1]);
 *    the column is Django's integer[], so strings go through
 *    mapRolesToDjango. `role` (single, NOT NULL) defaults to roles[0].
 *  - isPasswordSet is derived, not stored: a staff row with no usable
 *    password gets Django's own "unusable password" convention — a hash
 *    starting with "!" that check_password()/verifyDjangoPassword can never
 *    match — exactly what set_unusable_password() writes.
 *  - passwordResetToken/passwordResetExpires land in
 *    sman.staff_password_resets (the table that replaced those columns).
 */
const normalizeShape = (data) => {
  const { firstName, surname, otherNames, isPasswordSet, passwordResetToken, passwordResetExpires, profilePictureUrl, profilePicturePublicId, ...out } = data;
  if (!out.fullName) {
    const joined = [firstName, otherNames, surname].filter(Boolean).join(" ").trim();
    if (joined) out.fullName = joined;
  }
  if (Array.isArray(out.roles) && out.roles.some((r) => typeof r === "string")) {
    const { mapRolesToDjango } = require("../config/roleMapping");
    const strings = out.roles.filter((r) => typeof r === "string");
    const ints = out.roles.filter((r) => typeof r === "number");
    out.roles = [...new Set([...ints, ...mapRolesToDjango(strings)])];
  }
  return { normalized: out, passwordResetToken, passwordResetExpires };
};

/** Django's set_unusable_password(): "!" + random suffix; never verifiable. */
const unusablePassword = () => "!" + require("crypto").randomBytes(20).toString("hex");

const create = async (data) => {
  const { normalized: insertData, passwordResetToken, passwordResetExpires } = normalizeShape(data);

  insertData.password = insertData.password ? await hashDjangoPassword(insertData.password) : unusablePassword();
  if (insertData.email) insertData.email = insertData.email.toLowerCase();

  // NOT NULL columns with no DB default — Django fills these app-side.
  const now = new Date().toISOString();
  insertData.fullName = insertData.fullName ?? "";
  insertData.dateJoined = insertData.dateJoined ?? now;
  insertData.lastLogin = insertData.lastLogin ?? now;
  insertData.isSuperuser = insertData.isSuperuser ?? false;
  insertData.isStaff = insertData.isStaff ?? true;
  insertData.isActive = insertData.isActive ?? true;
  insertData.emailVerified = insertData.emailVerified ?? false;
  insertData.suspended = insertData.suspended ?? false;
  insertData.canViewAllLocations = insertData.canViewAllLocations ?? false;
  insertData.roles = insertData.roles?.length ? insertData.roles : [1]; // 1 = admin
  insertData.role = insertData.role ?? insertData.roles[0];

  const [row] = await db.insert(administrationUser).values(insertData).returning();

  if (passwordResetToken && passwordResetExpires) {
    await db.insert(staffPasswordResets).values({
      staffId: row.id,
      tokenHash: passwordResetToken,
      expiresAt: passwordResetExpires,
    });
  }
  return row;
};

const update = async (id, data) => {
  const { normalized: updateData, passwordResetToken, passwordResetExpires } = normalizeShape(data);
  if (updateData.password) {
    updateData.password = await hashDjangoPassword(updateData.password);
  }
  if (updateData.email) {
    updateData.email = updateData.email.toLowerCase();
  }
  const [row] = Object.keys(updateData).length
    ? await db.update(administrationUser).set(updateData).where(eq(administrationUser.id, id)).returning()
    : [await findById(id)];

  if (row && passwordResetToken && passwordResetExpires) {
    await db.insert(staffPasswordResets).values({
      staffId: row.id,
      tokenHash: passwordResetToken,
      expiresAt: passwordResetExpires,
    });
  }
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
