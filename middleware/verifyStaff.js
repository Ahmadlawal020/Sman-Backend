const { verifyAccessToken } = require("../services/token.service");
const sessionService = require("../services/session.service");

// Role VALUES, not table names — these are data, consumed by config/roleMapping.js
// and by the frontend. They are unrelated to the `staff` table rename.
const ELEVATED_ROLES = ["admin", "super_admin"];

/**
 * Verifies the bearer token, confirms the session behind it is still live, and
 * populates req.user. Authentication only — it makes no authorisation decision.
 *
 * The session check is what makes revocation immediate. Verifying the JWT
 * alone would leave a revoked session working until its 15-minute access token
 * expired, which defeats logout-all, suspension and reuse detection alike.
 */
const authenticateStaff = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  let claims;
  try {
    claims = verifyAccessToken("staff", token);
  } catch (err) {
    if (err.code === "expired") {
      return res.status(401).json({ success: false, message: "Token expired" });
    }
    // Preserved from the previous implementation: a malformed or wrongly
    // signed token is 403, not 401. Clients branch on this.
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  const active = await sessionService.loadActive("staff", claims.sid, claims.id);
  if (!active.ok) {
    return res.status(401).json({ success: false, message: "Session is no longer valid" });
  }

  // Shape preserved from the previous `decoded.UserInfo` payload so the 16
  // route files and their controllers keep working unchanged.
  //
  // Roles come from the freshly loaded row, not from the token: a role revoked
  // mid-session must take effect now, not when the access token expires.
  req.user = {
    id: active.principal.id,
    email: active.principal.email,
    roles: active.principal.roles || [],
  };
  // Deliberately not `req.session` — that name belongs to express-session, and
  // colliding with it would be a confusing trap if it is ever added.
  req.authSession = active.session;

  next();
};

/**
 * Authorisation: the caller must hold at least one of the given roles.
 * Realm-neutral, so the name stays correct.
 */
function requireRole(...allowedRoles) {
  // Optional trailing { message } preserves caller-specific wording.
  let message = "Insufficient permissions";
  const last = allowedRoles[allowedRoles.length - 1];
  if (last && typeof last === "object" && last.message) {
    message = last.message;
    allowedRoles = allowedRoles.slice(0, -1);
  }

  return (req, res, next) => {
    const roles = req.user?.roles || [];
    const hasRole = roles.some((r) => allowedRoles.includes(r));
    if (!hasRole) {
      return res.status(403).json({ success: false, message });
    }
    next();
  };
}

/**
 * Default export — behaviour-identical to the previous verifyAdmin.
 *
 * NOTE: ELEVATED_ROLES still admits only 2 of the 19 roles in
 * config/roleMapping.js, so this rejects most staff. Full RBAC is a separate
 * change; until it lands the name is aspirational. See CUSTOMER_PORTAL_PLAN §10.8.
 */
const verifyStaff = [
  authenticateStaff,
  requireRole(...ELEVATED_ROLES, { message: "Admin access required" }),
];

module.exports = verifyStaff;
module.exports.authenticateStaff = authenticateStaff;
module.exports.requireRole = requireRole;
module.exports.ELEVATED_ROLES = ELEVATED_ROLES;
