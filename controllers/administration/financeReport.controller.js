const asyncHandler = require("express-async-handler");
const { orderRepo } = require("../../repositories");

const parseDate = (val) => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Every confirmed payment, order by order — who paid, what for, and (where
 * the allocation ledger reaches) exactly which deposit(s) funded it, split
 * out as Paystack (DVA + originating bank) or manual bank transfer.
 */
const getFinanceReport = asyncHandler(async (req, res) => {
  const result = await orderRepo.findFinanceReport({
    search: req.query.search,
    paymentStatus: req.query.paymentStatus,
    dateFrom: parseDate(req.query.dateFrom),
    dateTo: parseDate(req.query.dateTo),
    scopeUser: req.user,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.json({ success: true, data: result });
});

module.exports = { getFinanceReport };
