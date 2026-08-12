const { eq, and, inArray, sql, count } = require("drizzle-orm");
const { db } = require("../config/db");
const {
  customers,
  customerIdentities,
  customerTrustedDevices,
  customerPasskeys,
  webauthnChallenges,
  customerOtps,
  walletHolds,
  orders,
  lpgOrderRequests,
  dangoteOrderRequests,
  notifications,
  notificationPreferences,
  notificationSettings,
  deviceTokens,
} = require("../db/schema");
const { sessionRepo } = require("../repositories");
const { principalWhere } = require("../utils/principal");

/**
 * Apple App Store Guideline 5.1.1(v): apps that create accounts must let the
 * user delete the account and associated personal data from inside the app.
 *
 * Pure soft-delete (Inactive + keep PII) fails review. Pure hard-delete of the
 * customers row fails here too — orders, deposits, commissions and licenses
 * reference customers with ON DELETE RESTRICT.
 *
 * So we anonymize the customer tombstone (keep the id for ledger FKs), wipe
 * every auth/identity surface, and refuse when open money or open work would
 * leave ops without a reachable principal.
 */

const OPEN_ORDER_STATUSES = ["Pending", "Paid", "Released", "Loading"];
const OPEN_REQUEST_STATUSES = ["Pending Review", "Approved"];
const REVOKE_REASON = "account_deleted";

const money = (value) => Number(value || 0);

/**
 * Reasons the account cannot be deleted yet. Empty array means clear.
 * Evaluated against a fresh row so a concurrent top-up cannot sneak past.
 */
async function collectBlockers(customerId, tx = db) {
  const [customer] = await tx
    .select({
      id: customers.id,
      balance: customers.balance,
      status: customers.status,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!customer) {
    return { customer: null, blockers: ["Account not found"] };
  }

  const blockers = [];

  if (money(customer.balance) > 0) {
    blockers.push("Wallet still has a balance. Withdraw or spend it before deleting.");
  }

  const [[{ holds }], [{ openOrders }], [{ openLpg }], [{ openDangote }]] = await Promise.all([
    tx
      .select({ holds: count() })
      .from(walletHolds)
      .where(and(eq(walletHolds.customerId, customerId), eq(walletHolds.status, "active"))),
    tx
      .select({ openOrders: count() })
      .from(orders)
      .where(and(eq(orders.customerId, customerId), inArray(orders.status, OPEN_ORDER_STATUSES))),
    tx
      .select({ openLpg: count() })
      .from(lpgOrderRequests)
      .where(
        and(
          eq(lpgOrderRequests.customerId, customerId),
          inArray(lpgOrderRequests.status, OPEN_REQUEST_STATUSES)
        )
      ),
    tx
      .select({ openDangote: count() })
      .from(dangoteOrderRequests)
      .where(
        and(
          eq(dangoteOrderRequests.customerId, customerId),
          inArray(dangoteOrderRequests.status, OPEN_REQUEST_STATUSES)
        )
      ),
  ]);

  if (Number(holds) > 0) {
    blockers.push("An order still has funds on hold. Finish or cancel it first.");
  }
  if (Number(openOrders) > 0) {
    blockers.push("You have open orders. Complete or cancel them before deleting.");
  }
  if (Number(openLpg) > 0) {
    blockers.push("You have an open LPG request. Cancel it before deleting.");
  }
  if (Number(openDangote) > 0) {
    blockers.push("You have an open Dangote request. Cancel it before deleting.");
  }

  return { customer, blockers };
}

/** Scrub every personal field; free the unique phone for a future registration. */
function anonymizedFields(customerId) {
  return {
    name: "Deleted User",
    email: "",
    phone: `deleted_${customerId}`,
    companyName: "",
    address: "",
    commissionBankName: "",
    commissionAccountName: "",
    commissionAccountNumber: "",
    paystackCustomerId: "",
    virtualAccountNumber: "",
    virtualAccountBank: "",
    virtualAccountName: "",
    dvaSubaccountCode: "",
    phoneVerifiedAt: null,
    status: "Inactive",
    updatedAt: new Date(),
  };
}

async function wipeAuthSurfaces(customerId, tx) {
  const principal = { type: "customer", id: customerId };

  await sessionRepo.revokeAllForPrincipal("customer", customerId, REVOKE_REASON, tx);

  await tx
    .update(deviceTokens)
    .set({
      disabledAt: new Date(),
      disabledReason: REVOKE_REASON,
      updatedAt: new Date(),
    })
    .where(and(principalWhere(deviceTokens, principal), sql`${deviceTokens.disabledAt} IS NULL`));

  await Promise.all([
    tx.delete(customerIdentities).where(eq(customerIdentities.customerId, customerId)),
    tx.delete(customerTrustedDevices).where(eq(customerTrustedDevices.customerId, customerId)),
    tx.delete(customerPasskeys).where(eq(customerPasskeys.customerId, customerId)),
    tx.delete(webauthnChallenges).where(eq(webauthnChallenges.customerId, customerId)),
    tx.delete(customerOtps).where(eq(customerOtps.customerId, customerId)),
    tx.delete(notificationPreferences).where(principalWhere(notificationPreferences, principal)),
    tx.delete(notificationSettings).where(principalWhere(notificationSettings, principal)),
    tx.delete(notifications).where(principalWhere(notifications, principal)),
  ]);
}

/**
 * Delete the customer's account for App Store compliance.
 *
 * @returns {{ ok: true, deletedAt: Date } | { ok: false, status: number, message: string, blockers?: string[] }}
 */
async function deleteCustomerAccount(customerId) {
  const id = Number(customerId);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, status: 400, message: "Invalid account" };
  }

  return db.transaction(async (tx) => {
    const { customer, blockers } = await collectBlockers(id, tx);
    if (!customer) {
      return { ok: false, status: 404, message: "Account not found" };
    }
    if (blockers.length > 0) {
      return {
        ok: false,
        status: 409,
        message: blockers[0],
        blockers,
      };
    }

    await wipeAuthSurfaces(id, tx);

    const [updated] = await tx
      .update(customers)
      .set(anonymizedFields(id))
      .where(eq(customers.id, id))
      .returning({ id: customers.id, updatedAt: customers.updatedAt });

    if (!updated) {
      return { ok: false, status: 404, message: "Account not found" };
    }

    return { ok: true, deletedAt: updated.updatedAt };
  });
}

module.exports = {
  deleteCustomerAccount,
  collectBlockers,
  anonymizedFields,
  OPEN_ORDER_STATUSES,
  OPEN_REQUEST_STATUSES,
  REVOKE_REASON,
};
