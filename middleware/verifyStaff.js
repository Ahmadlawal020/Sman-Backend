const jwt = require("jsonwebtoken");

// Role VALUES, not table names — these are data, consumed by config/roleMapping.js
// and by the frontend. They are unrelated to the `staff` table rename.
const ELEVATED_ROLES = ["admin", "super_admin"];

/**
 * Verifies the bearer token and populates req.user.
 * Authentication only — it makes no authorisation decision.
 */
const authenticateStaff = (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      if (err.name === "TokenExpiredError") {
        return res
          .status(401)
          .json({ success: false, message: "Token expired" });
      }
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    req.user = decoded.UserInfo;
    next();
  });
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
