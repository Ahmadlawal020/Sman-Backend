const asyncHandler = require("express-async-handler");
const { customerRepo } = require("../../repositories");
const { publicCustomer } = require("../../utils/publicCustomer");

/**
 * The signed-in customer's own profile — publicCustomer plus the fields the
 * account screen needs that the auth payload deliberately omits: the address
 * and the dedicated virtual account. The virtual account is the customer's
 * permanent funding route, so the portal shows it outside any one order.
 */
const profilePayload = (customer) => ({
  customer: { ...publicCustomer(customer), address: customer.address || "" },
  virtualAccount: customer.virtualAccountNumber
    ? {
        bank: customer.virtualAccountBank,
        accountNumber: customer.virtualAccountNumber,
        accountName: customer.virtualAccountName,
      }
    : null,
});

/** GET /api/customer/profile */
const getMyProfile = asyncHandler(async (req, res) => {
  res.json({ success: true, data: profilePayload(req.customer) });
});

/** PATCH /api/customer/profile — text fields only; see profile.schema. */
const updateMyProfile = asyncHandler(async (req, res) => {
  const allowed = ["name", "companyName", "email", "address"];
  const patch = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) patch[key] = req.body[key];
  }

  const updated = await customerRepo.update(req.customer.id, patch);
  res.json({ success: true, message: "Profile updated", data: profilePayload(updated) });
});

module.exports = { getMyProfile, updateMyProfile };
