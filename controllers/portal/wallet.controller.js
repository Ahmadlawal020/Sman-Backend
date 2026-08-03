const asyncHandler = require("express-async-handler");
const { depositRepo } = require("../../repositories");

/** A bounded date parse: returns a valid Date, or undefined for empty/garbage. */
function parseWhen(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * GET /api/customer/wallet/transactions — the signed-in customer's own wallet
 * ledger (credits and debits), newest first, with an optional date window. The
 * dashboard exposes only the running balance; this is the paginated history
 * behind it. Scoped to req.customer — a customer only ever sees their own rows.
 */
const getMyWalletTransactions = asyncHandler(async (req, res) => {
  const { page, limit, dateFrom, dateTo } = req.query;

  const { rows, pagination } = await depositRepo.findCustomerHistory({
    customerId: req.customer.id,
    page,
    limit,
    dateFrom: parseWhen(dateFrom),
    dateTo: parseWhen(dateTo),
  });

  res.json({
    success: true,
    // Shape matches what the app already builds against: a `data` array of
    // transactions alongside `pagination`.
    data: {
      data: rows.map((r) => ({
        id: r.id,
        type: r.type, // 'credit' | 'debit'
        amount: Number(r.amount),
        ref: r.reference || null,
        description: r.description || "",
        balanceAfter: Number(r.balanceAfter),
        at: r.createdAt,
      })),
      pagination,
    },
  });
});

module.exports = { getMyWalletTransactions };
