const asyncHandler = require("express-async-handler");
const { commissionRepo } = require("../../repositories");

function parseWhen(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const getMyCommissions = asyncHandler(async (req, res) => {
  const { page, limit, status, dateFrom, dateTo } = req.query;

  const result = await commissionRepo.findAll({
    customerId: req.customer.id,
    status,
    dateFrom: parseWhen(dateFrom),
    dateTo: parseWhen(dateTo),
    page,
    limit,
  });

  res.json({
    success: true,
    data: {
      commissions: result.commissions.map((c) => ({
        id: c.id,
        orderId: c.orderId,
        orderNumber: c.orderNumber,
        depotName: c.depotName,
        productName: c.productName,
        quantity: c.quantity,
        commissionRate: c.commissionRate,
        commissionAmount: c.commissionAmount,
        status: c.status,
        paidAt: c.paidAt,
        createdAt: c.createdAt,
      })),
      pagination: result.pagination,
    },
  });
});

const getMySummary = asyncHandler(async (req, res) => {
  const summary = await commissionRepo.getSummary({
    customerId: req.customer.id,
  });

  res.json({ success: true, data: { summary } });
});

module.exports = { getMyCommissions, getMySummary };
