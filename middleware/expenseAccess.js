const chain = require("../lib/expenseChain");

/**
 * Gate for the review endpoint.
 *
 * The app-wide `verifyStaff` admits only admin and super_admin, which would
 * shut the Expenditure Officer and the CFO out of the queue they exist to
 * work — so the expense routes authenticate first and authorise here instead.
 *
 * This only asks "could you ever review anything?". Whether you may perform
 * *this* action on *this* request at *this* stage is the chain's decision, and
 * it stays there so there is one source of truth for the rules.
 */
function requireExpenseRole(req, res, next) {
  if (!chain.canOversee(req.user)) {
    return res.status(403).json({
      success: false,
      message: "Your role does not take part in expense approvals",
    });
  }
  next();
}

module.exports = { requireExpenseRole };
