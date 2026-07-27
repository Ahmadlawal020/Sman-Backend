// The customer shape returned to clients — never the raw row (no password
// hashes, no internal ids for other tables). Shared so every auth entry
// point (OTP, password, PIN, Google, Apple, passkey) answers identically.
const publicCustomer = (customer) => ({
  id: customer.id,
  name: customer.name,
  phone: customer.phone,
  email: customer.email || null,
  companyName: customer.companyName || null,
  status: customer.status,
  phoneVerifiedAt: customer.phoneVerifiedAt,
});

module.exports = { publicCustomer };
