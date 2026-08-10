const { createDedicatedAccount } = require("./payment.service");
const { deliveryCustomerRepo } = require("../repositories");
const { virtualAccountName } = require("../utils/helpers");

async function generateDeliveryCustomerDva(deliveryCustomer) {
  const customerForPaystack = {
    _id: deliveryCustomer.id,
    name: deliveryCustomer.name,
    email: deliveryCustomer.email || `delivery-${deliveryCustomer.id}@soroman.com`,
    phone: deliveryCustomer.phoneNumber || "",
    paystackCustomerId: deliveryCustomer.paystackCustomerId || "",
  };

  const result = await createDedicatedAccount(customerForPaystack);

  if (result.success && result.data) {
    const virtualAccountName = result.data.accountName || virtualAccountName(deliveryCustomer.name);
    await deliveryCustomerRepo.update(deliveryCustomer.id, {
      virtualAccountNumber: result.data.accountNumber,
      virtualAccountBank: result.data.bankName,
      virtualAccountName,
      ...(result.data.paystackCustomerId
        ? { paystackCustomerId: result.data.paystackCustomerId }
        : {}),
    });
  }

  return result;
}

module.exports = { generateDeliveryCustomerDva };
