const jwt = require("jsonwebtoken");

const ADMIN_ROLES = ["admin", "super_admin"];

const verifyAdmin = [
  (req, res, next) => {
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
  },
  (req, res, next) => {
    const roles = req.user?.roles || [];
    const hasAdminRole = roles.some((role) => ADMIN_ROLES.includes(role));

    if (!hasAdminRole) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    next();
  },
];

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const roles = req.user?.roles || [];
    const hasRole = roles.some((r) => allowedRoles.includes(r));
    if (!hasRole) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
      });
    }
    next();
  };
}

module.exports = verifyAdmin;
module.exports.requireRole = requireRole;
module.exports.ADMIN_ROLES = ADMIN_ROLES;
