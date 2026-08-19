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
 * Ordering used to require an "Active" account (Pending = phone not yet
 * verified, Inactive = staff deactivation). consumer_customer — Django's
 * real table — has no status column at all, so after the live-DB cutover
 * `req.customer.status` is always undefined and this gate 403'd EVERY
 * customer request on the routes that use it (orders, licenses, uploads,
 * Dangote, LPG): the whole ordering flow, not just deactivated accounts.
 *
 * Decision (2026-08-19): the status feature is accepted as gone rather than
 * rebuilt on a sman table. Holding a valid session token — which requires
 * having passed OTP verification — is the activation gate now. This is kept
 * as an explicit pass-through (rather than unwiring every route) so the gate
 * has an obvious home if account deactivation ever gets a live backing.
 */
const requireActiveCustomer = (req, res, next) => {
  next();
};

const verifyCustomer = [authenticateCustomer];

module.exports = verifyCustomer;
module.exports.authenticateCustomer = authenticateCustomer;
module.exports.requireActiveCustomer = requireActiveCustomer;
