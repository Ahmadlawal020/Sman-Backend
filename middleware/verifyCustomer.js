const { verifyAccessToken } = require("../services/token.service");
const sessionService = require("../services/session.service");

/**
 * Customer-realm authentication.
 *
 * Deliberately separate from verifyStaff rather than a parameterised shared
 * middleware: the two realms differ in their claims (customers have no roles),
 * their failure codes, and what "usable" means for the principal. A single
 * generic middleware with a realm argument reads as safer than it is — one
 * missed default and a customer is authenticated against the staff table.
 */
const authenticateCustomer = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  let claims;
  try {
    claims = verifyAccessToken("customer", token);
  } catch (err) {
    if (err.code === "expired") {
      return res.status(401).json({ success: false, message: "Token expired" });
    }
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const active = await sessionService.loadActive("customer", claims.sid, claims.id);
  if (!active.ok) {
    return res.status(401).json({ success: false, message: "Session is no longer valid" });
  }

  req.customer = active.principal;
  req.authSession = active.session;
  next();
};

/**
 * Ordering requires an activated account. Authentication and browsing do not —
 * a Pending customer can sign in and watch their application, they just cannot
 * transact.
 *
 * Enforced here rather than in the UI, because the UI is not a security
 * boundary.
 */
const requireActiveCustomer = (req, res, next) => {
  if (req.customer?.status !== "Active") {
    return res.status(403).json({
      success: false,
      message: "Your account is pending approval. Please contact Soroman to activate it.",
    });
  }
  next();
};

const verifyCustomer = [authenticateCustomer];

module.exports = verifyCustomer;
module.exports.authenticateCustomer = authenticateCustomer;
module.exports.requireActiveCustomer = requireActiveCustomer;
