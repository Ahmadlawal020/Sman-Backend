/**
 * Django's real `Roles.IntegerChoices` (soroman_backend-2/administration/models.py)
 * — the values `administration_user.roles` (integer[]) actually holds live.
 * Every entry below is evidence-backed, not guessed:
 *
 *   0  SUPERADMIN        "Support"           -> super_admin
 *   1  ADMIN             "Administration"    -> admin
 *   2  FINANCE           "Finance"           -> finance   (confirmed: Django's
 *      ConfirmPaymentAPIView is gated "FINANCE|ADMIN|SUPERADMIN only")
 *   3  SALES             "Sales"             -> sales_manager (label match; Sman's
 *      "truck_sales"/"product_manager" strings have no Django counterpart and
 *      are deliberately left unmapped rather than guessed)
 *   4  RELEASE           "Ticketing"         -> ticketing (exact label match)
 *   5  SECURITY          "Security"          -> security_entry AND security_exit.
 *      Django has ONE security role; Sman's own routes (order.route.js) check
 *      security_entry (gate-in) and security_exit (gate-out) SEPARATELY. Django's
 *      schema cannot currently tell the two apart, so a Security-role staffer is
 *      granted BOTH here rather than arbitrarily locked out of half their gate
 *      duties. Revisit if entry/exit staff are ever split into distinct people.
 *   6  TRANSPORT         "Transport"         -> transport
 *   7  RELEASE_OFFICER   "Release"           -> release (exact label match)
 *   8  AUDITOR           "Audit"             -> audit. Confirmed READ-ONLY by
 *      Django itself (IsAuditorReadOnly: role 8 gets GET/HEAD/OPTIONS only,
 *      blocked from every write) — this role can never be the CFO/payment
 *      approver. (lib/expenseChain.js previously carried a comment claiming
 *      "Audit (8) -> finance"; that was never wired up or verified against
 *      live data and is wrong — see the fix there.)
 *   9  MARKETING         "Marketing"         -> (unmapped: no Sman permission
 *      string checks for a marketing role anywhere in this codebase)
 *   10 LOCATION_MANAGER  "Location Manager"  -> (unmapped: same, unused)
 *   11 LPG_ADMIN         "LPG Admin"         -> lpg_dashboard, lpg_plants,
 *      lpg_stock, lpg_sales. Per Django's administration/permissions.py,
 *      LPG_ADMIN is in LPG_ADMIN_ROLES ⊆ LPG_STOCK_ROLES ⊆ LPG_SALES_ROLES —
 *      full access to all three LPG permission tiers.
 *   12 STATION_MANAGER   "Filling Station Manager" -> (unmapped: not part of
 *      any Django LPG permission tier — governs the separate filling-station
 *      module, which Sman does not yet gate by a distinct role string)
 *   13 LPG_PLANT_MANAGER "LPG Plant Manager" -> lpg_dashboard, lpg_stock,
 *      lpg_sales (Django's LPG_STOCK_ROLES + LPG_SALES_ROLES, NOT
 *      LPG_ADMIN_ROLES — cannot manage plants)
 *   14 LPG_CASHIER       "LPG Cashier"       -> lpg_sales (Django's
 *      LPG_SALES_ROLES only)
 *   15 COMMISSIONS       "Commissions"       -> commissions (exact label match)
 *   16 COMMISSION_OFFICER "Commission Officer" -> commission_officer (exact
 *      label match)
 *   17 DISPATCH          "Dispatch"          -> dispatch (exact label match)
 *   18 IT_COMPLIANCE     "IT Compliance"     -> it_compliance (exact label
 *      match)
 *   19 EXPENDITURE_OFFICER "Expenditure Officer" -> expenditure_officer
 *      (confirmed by lib/expenseChain.js's own "Expenditure Officer (19) ->
 *      expenditure_officer" comment, which IS correct)
 *
 * A `null` entry means: no Sman permission string currently checks for this
 * Django role. Leaving it unmapped is a deliberate, safe default — it grants
 * nothing extra rather than guessing at a string that might be wrong. A staff
 * member holding only an unmapped role still gets whatever `admin`/implicit
 * access already covers; nothing here can produce a false grant.
 */
const ROLE_MAP = {
  0: "super_admin",
  1: "admin",
  2: "finance",
  3: "sales_manager",
  4: "ticketing",
  5: ["security_entry", "security_exit"],
  6: "transport",
  7: "release",
  8: "audit",
  9: null,
  10: null,
  11: ["lpg_dashboard", "lpg_plants", "lpg_stock", "lpg_sales"],
  12: null,
  13: ["lpg_dashboard", "lpg_stock", "lpg_sales"],
  14: "lpg_sales",
  15: "commissions",
  16: "commission_officer",
  17: "dispatch",
  18: "it_compliance",
  19: "expenditure_officer",
};

/** Django role integers -> Sman's permission-string vocabulary, flattened and deduped. */
const mapRolesToBackend = (numericRoles) => {
  const out = new Set();
  for (const r of numericRoles || []) {
    const mapped = ROLE_MAP[r];
    if (!mapped) continue;
    if (Array.isArray(mapped)) mapped.forEach((s) => out.add(s));
    else out.add(mapped);
  }
  return [...out];
};

/**
 * The reverse index, built once from ROLE_MAP: Sman role string -> every
 * Django integer whose forward mapping produces it. Needed anywhere a
 * `{ roles: ["admin", ...] }` broadcast spec has to become a
 * `administration_user.roles && ARRAY[...]` query (see notifications/recipients.js) —
 * the DB column is Django's integer[], so a string-keyed filter has to go
 * through this before it can match anything.
 */
const STRING_TO_ROLE_IDS = (() => {
  const index = new Map();
  for (const [id, mapped] of Object.entries(ROLE_MAP)) {
    if (!mapped) continue;
    const strings = Array.isArray(mapped) ? mapped : [mapped];
    for (const s of strings) {
      if (!index.has(s)) index.set(s, []);
      index.get(s).push(Number(id));
    }
  }
  return index;
})();

/**
 * Sman role strings -> deduped Django role integers. Strings with no Django
 * counterpart (e.g. "finance_manager", "fleet_manager", "truck_sales" —
 * naming drift elsewhere in this codebase, not fixed here since the intended
 * Django role is a business call, not something derivable from source) are
 * silently dropped rather than guessed — the caller gets an empty/narrower
 * match instead of a wrong one.
 */
const mapRolesToDjango = (stringRoles) => {
  const out = new Set();
  for (const s of stringRoles || []) {
    for (const id of STRING_TO_ROLE_IDS.get(s) || []) out.add(id);
  }
  return [...out];
};

module.exports = { ROLE_MAP, mapRolesToBackend, mapRolesToDjango };
