/**
 * Which roles may reach which API resource.
 *
 * Read access is open to any signed-in staff member almost everywhere —
 * matching the dashboard's own rule that page visibility is the only gate a
 * user should feel. Location/PFI scope (see lib/scopeFilter.js) still narrows
 * *which rows* a non-super_admin sees; this file only ever decided whether
 * the endpoint was reachable at all, and for read traffic it mostly no longer
 * does. Write access stays role-gated: fetching an order and cancelling one
 * are different permissions, so mutating verbs still consult `write`.
 *
 * A short list stays fully role-gated on both read and write — staff/account
 * administration, customer broadcast messaging, and anything that exposes
 * bank/settlement/commission money movement — because those pages are not
 * shown to most roles in the dashboard nav in the first place, so "open to
 * anyone who can see the page" would mean opening them to almost nobody's
 * actual page and everybody's actual API access.
 *
 * super_admin is implicit everywhere and never listed.
 */

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Role groups, named after what they do rather than who holds them. Still
// used to gate WRITE access on most resources, and both read+write on the
// small still-restricted list below.
const OPS = ["admin", "ticketing", "release", "dispatch", "transport"];
const MONEY = ["admin", "finance", "audit", "commissions", "commission_officer"];
const SALES = ["admin", "sales_manager", "truck_sales", "product_manager"];
const LPG = ["admin", "lpg_dashboard", "lpg_plants", "lpg_stock", "lpg_sales"];
const SECURITY = ["admin", "security_entry", "security_exit"];
// Filers of the five daily returns under My Report (see ROLE_REPORT in the
// dashboard's report-config.ts) plus the roles the Reports Hub is gated to.
const REPORTS = [
  "admin",
  "sales_manager",
  "product_manager",
  "security_entry",
  "commissions",
  "commission_officer",
  "it_compliance",
];

/**
 * mount path -> { read: [...roles] | null, write: [...roles] | null }
 *
 * A missing `write` means the read list governs both. An empty `write: []`
 * means nobody but super_admin may mutate it. `null` means any signed-in
 * staff member.
 */
const API_PERMISSIONS = {
  // Everyone signed in needs these.
  "/api/dashboard": { read: null },
  "/api/notifications": { read: null },
  "/api/uploads": { read: null },

  // Security is on the write list because gate-in / gate-out are POSTs
  // against the order.
  "/api/orders": { read: null, write: [...OPS, ...SECURITY, "admin"] },
  "/api/tickets": { read: null, write: OPS },
  "/api/customers": { read: null },
  "/api/customer-licenses": { read: null, write: ["admin"] },

  "/api/depots": { read: null, write: ["admin"] },
  "/api/products": { read: null, write: ["admin", "product_manager"] },
  "/api/trucks": { read: null, write: [...OPS] },
  "/api/fleet": { read: null, write: [...OPS] },
  "/api/drivers": { read: null, write: OPS },

  // Expenses/vendors were already open on both read and write: anyone may
  // raise a request and must be able to see their own; the chain module
  // decides who can review, and scope narrows non-oversight users to their
  // own rows.
  "/api/expenses": { read: null },
  "/api/vendors": { read: null },
  // Still gated, read and write: exposes customer bank/sender account
  // details, not just spend totals — same category as bank-accounts below.
  "/api/finance-report": { read: ["admin", "finance", "audit"] },
  "/api/pfis": { read: null, write: ["admin", "finance"] },
  // Still gated, read and write: this is the raw money-in ledger, same
  // category as bank-accounts/bank-statements/settlements below.
  "/api/deposits": { read: MONEY, write: ["admin", "finance"] },
  "/api/expected-payments": { read: null },
  "/api/bank-accounts": { read: MONEY, write: ["admin", "finance"] },
  "/api/bank-statements": { read: MONEY, write: ["admin", "finance"] },
  "/api/settlements": { read: MONEY, write: ["admin", "finance"] },
  "/api/commissions": { read: MONEY, write: ["admin", "commissions", "commission_officer"] },

  "/api/lpg-stations": { read: null, write: LPG },
  "/api/filing-stations": { read: null, write: ["admin", "truck_sales"] },
  "/api/delivery-customers": { read: null, write: SALES },
  "/api/delivery-inventory": { read: null, write: SALES },
  "/api/delivery-sales": { read: null, write: SALES },
  "/api/offline-sales": { read: null, write: SALES },

  "/api/incidents": { read: null, write: [...SECURITY, ...OPS] },
  // audit can view (it's on the Reports Hub's allowed-roles list) but not
  // file — write stays with the five reporting roles themselves.
  "/api/daily-reports": { read: null, write: REPORTS },
  "/api/reports": { read: null, write: [...MONEY, ...OPS, "audit"] },
  "/api/order-expiry": { read: null, write: ["admin"] },

  // These three sit on routers mounted at bare /api, so they are matched on
  // the full request path rather than the mount — see resolveRule.
  "/api/dangote-order-requests": { read: null, write: [...SALES, "admin"] },
  "/api/dangote-products": { read: null, write: ["admin", "product_manager"] },
  "/api/lpg-order-requests": { read: null, write: [...LPG, "admin"] },

  // Staff administration stays with admins: creating a staff account or
  // assigning super_admin is not something page-visibility should gate.
  "/api/admin": { read: ["admin"], write: ["admin"] },
  // Same boundary as /api/notifications' broadcast route — only reachable
  // from the messaging page, which is itself admin/super_admin only.
  "/api/message-templates": { read: ["admin"], write: ["admin"] },
};

/**
 * Longest-prefix match on the full path.
 *
 * Most routers mount at their own path, so `req.baseUrl` identifies them. A
 * few (Dangote, LPG) mount at bare /api and carry their resource in the
 * sub-path, which would otherwise resolve to an /api rule that does not
 * exist and lock everyone out. Matching the full path covers both, and
 * longest-first means /api/dangote-products wins over any shorter prefix.
 */
const SORTED_PATHS = Object.keys(API_PERMISSIONS).sort((a, b) => b.length - a.length);

function resolveRule(fullPath) {
  for (const key of SORTED_PATHS) {
    if (fullPath === key || fullPath.startsWith(key + "/")) return API_PERMISSIONS[key];
  }
  return null;
}

/** Roles the caller holds, from both the singular field and the array. */
function rolesOf(user) {
  const list = Array.isArray(user?.roles) ? user.roles : [];
  return new Set([...list, user?.role].filter(Boolean));
}

/**
 * @returns {{allowed: boolean, reason?: string}}
 */
function checkApiAccess(fullPath, method, user) {
  const rule = resolveRule(fullPath);
  // An unlisted mount is closed to everyone but super_admin — a new route
  // should have to opt in rather than default to open.
  const mine = rolesOf(user);
  if (mine.has("super_admin")) return { allowed: true };
  if (!rule) return { allowed: false, reason: "This area is restricted" };

  const readList = rule.read;
  // null means "any signed-in staff".
  if (readList === null && READ_ONLY_METHODS.has(method)) return { allowed: true };

  const writeList = rule.write === undefined ? readList : rule.write;
  const required = READ_ONLY_METHODS.has(method) ? readList : writeList;

  if (required === null) return { allowed: true };
  if (Array.isArray(required) && required.some((r) => mine.has(r))) return { allowed: true };

  return {
    allowed: false,
    reason: READ_ONLY_METHODS.has(method)
      ? "Your role does not have access to this area"
      : "Your role cannot make changes here",
  };
}

module.exports = { API_PERMISSIONS, checkApiAccess, resolveRule, rolesOf, READ_ONLY_METHODS };
