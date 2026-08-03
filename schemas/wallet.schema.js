const z = require("zod");
const { pagination } = require("./fields");

// Kept as bounded strings (not coerced to Date here) to mirror the order-list
// filters — an empty or malformed value is ignored by the controller rather
// than 400-ing the whole request. The controller parses them to Date and drops
// anything unparseable before it reaches the query.
const listTransactions = pagination.extend({
  dateFrom: z.string().trim().max(40, "Start date is too long").optional(),
  dateTo: z.string().trim().max(40, "End date is too long").optional(),
});

module.exports = { listTransactions };
