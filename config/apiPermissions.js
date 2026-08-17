/**
 * Which roles may reach which API resource.
 *
 * This replaces a blanket `["admin", "super_admin"]` gate that sat on 33 route
 * files. The dashboard already ships a role→route table and hides menu items
 * accordingly, but the server admitted only two roles — so a finance or
 * ticketing user saw a full menu and got 403 from every page behind it. The
 * guard was decorative. This is the server-side half.
 *
 * Read access is keyed by mount path. Write access is narrower: a role that
 * may look at orders is not automatically allowed to cancel one, so mutating
 * verbs consult `WRITE` and fall back to `READ` where a resource draws no
 * distinction.
 *
 * super_admin is implicit everywhere and never listed.
 */

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Role groups, named after what they do rather than who holds them.
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
 * mount path -> { read: [...roles], write: [...roles] }
 *
 * A missing `write` means the read list governs both. An empty `write: []`
 * means nobody but super_admin may mutate it.
 */
const API_PERMISSIONS = {
  // Everyone signed in needs these.
  "/api/dashboard": { read: null },
  "/api/notifications": { read: null },
  "/api/uploads": { read: null },

  // Security is on the read list because the gate pages look an order up by
  // reference before checking a truck in, and on the write list because
  // gate-in / gate-out are POSTs against the order.
  "/api/orders": {
    read: [...OPS, ...MONEY, ...SALES, ...SECURITY],
    write: [...OPS, ...SECURITY, "admin"],
  },
  "/api/tickets": { read: [...OPS, ...SECURITY, "audit"], write: OPS },
  "/api/customers": { read: [...SALES, ...MONEY, ...OPS], write: [...SALES, "admin"] },
  "/api/customer-licenses": { read: [...SALES, ...MONEY], write: ["admin"] },

  "/api/depots": { read: [...OPS, ...SALES, ...MONEY], write: ["admin"] },
  "/api/products": { read: [...OPS, ...SALES, ...MONEY], write: ["admin", "product_manager"] },
  "/api/trucks": { read: [...OPS, ...SALES], write: [...OPS] },
  "/api/fleet": { read: [...OPS, ...MONEY], write: [...OPS] },
  "/api/drivers": { read: [...OPS, ...SALES], write: OPS },

  // Money. Expenses deliberately admits any signed-in staff to read: anyone
  // may raise a request and must be able to see their own. The chain module
  // decides who can review, and the list scopes non-oversight users to their
  // own rows.
  "/api/expenses": { read: null },
  // Same reasoning as expenses: any staff raising a request for a
  // not-yet-listed vendor must be able to save it there and then, not wait on
  // a finance admin to add it first.
  "/api/vendors": { read: null },
  // Narrower than MONEY (which includes commissions roles) — this exposes
  // customer bank/sender account details, not just spend totals.
  "/api/finance-report": { read: ["admin", "finance", "audit"] },
  "/api/pfis": { read: [...MONEY, ...SALES], write: ["admin", "finance"] },
  "/api/deposits": { read: MONEY, write: ["admin", "finance"] },
  // Deliberately open, unlike deposits: this is an advisory note, not money
  // movement, and it's written from two different contexts by two different
  // staff populations — sales/ops staff placing an order, and finance staff
  // working the customer's page or a manual deposit. Narrowing it to MONEY
  // would 403 the order-wizard case for no real protection.
  "/api/expected-payments": { read: null },
  "/api/bank-accounts": { read: MONEY, write: ["admin", "finance"] },
  "/api/bank-statements": { read: MONEY, write: ["admin", "finance"] },
  "/api/settlements": { read: MONEY, write: ["admin", "finance"] },
  "/api/commissions": { read: MONEY, write: ["admin", "commissions", "commission_officer"] },

  "/api/lpg-stations": { read: [...LPG, ...MONEY], write: LPG },
  "/api/filing-stations": { read: [...SALES, ...OPS], write: ["admin", "truck_sales"] },
  "/api/delivery-customers": { read: [...SALES, ...MONEY], write: SALES },
  "/api/delivery-inventory": { read: [...SALES, ...OPS], write: SALES },
  "/api/delivery-sales": { read: [...SALES, ...MONEY], write: SALES },
  "/api/offline-sales": { read: [...SALES, ...MONEY], write: SALES },

  "/api/incidents": { read: [...SECURITY, ...OPS, "audit"], write: [...SECURITY, ...OPS] },
  "/api/daily-reports": { read: [...OPS, ...MONEY, "audit"], write: OPS },
  "/api/reports": { read: [...MONEY, ...OPS, "audit"] },
  "/api/order-expiry": { read: [...OPS, ...MONEY], write: ["admin"] },

  // These three sit on routers mounted at bare /api, so they are matched on
  // the full request path rather than the mount — see resolveRule.
  "/api/dangote-order-requests": { read: [...SALES, ...MONEY, ...OPS], write: [...SALES, "admin"] },
  "/api/dangote-products": { read: [...SALES, ...OPS, ...MONEY], write: ["admin", "product_manager"] },
  "/api/lpg-order-requests": { read: [...LPG, ...SALES, ...MONEY], write: [...LPG, "admin"] },

  // Staff administration stays with admins.
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
