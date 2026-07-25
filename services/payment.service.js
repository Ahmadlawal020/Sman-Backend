const axios = require("axios");

const { getCustomerInitials } = require("../utils/helpers");

const PAYSTACK_BASE_URL = "https://api.paystack.co";

const getPaystackHeaders = () => ({
  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
  "Content-Type": "application/json",
});

const splitName = (name) => {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { first_name: "C", last_name: "U" };
  }
  const initials = parts.map((p) => p.charAt(0).toUpperCase());
  return {
    first_name: initials[0] || "",
    last_name: initials.slice(1).join(" ") || initials[0] || "",
  };
};

const createDedicatedAccount = async (customer) => {
  try {
    let paystackCustomerId = customer.paystackCustomerId || "";
    const { first_name, last_name } = splitName(customer.name);

    if (!paystackCustomerId) {
      const customerPayload = {
        first_name,
        last_name,
        email: customer.email || `customer-${customer._id || customer.id}@soroman.com`,
        phone: customer.phone,
      };

      const customerResponse = await axios.post(
        `${PAYSTACK_BASE_URL}/customer`,
        customerPayload,
        { headers: getPaystackHeaders() }
      );

      if (customerResponse.data.status) {
        paystackCustomerId = customerResponse.data.data.customer_code;
      } else {
        return { success: false, message: "Failed to create Paystack customer" };
      }
    }

    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/dedicated_account`,
      {
        customer: paystackCustomerId,
        first_name,
        last_name,
        email: customer.email || `customer-${customer._id || customer.id}@soroman.com`,
        phone: customer.phone,
        preferred_bank: "wema-bank",
      },
      { headers: getPaystackHeaders() }
    );

    if (response.data.status) {
      const data = response.data.data;
      const accountName = data.account_name || `SOROMANNIGERI/ ${getCustomerInitials(customer.name)}`;
      return {
        success: true,
        data: {
          paystackCustomerId: data.customer?.customer_code || paystackCustomerId,
          accountNumber: data.account_number,
          bankName: data.bank?.name,
          accountName,
        },
      };
    }

    return { success: false, message: "Paystack request failed" };
  } catch (error) {
    const errMsg =
      error.response?.data?.message || error.message || "Paystack error";
    console.error("Paystack dedicated account error:", errMsg);
    return { success: false, message: errMsg };
  }
};

const verifyTransaction = async (reference) => {
  try {
    const response = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
      { headers: getPaystackHeaders() }
    );

    if (response.data.status) {
      return { success: true, data: response.data.data };
    }

    return { success: false, message: "Verification failed" };
  } catch (error) {
    const errMsg =
      error.response?.data?.message || error.message || "Verification error";
    console.error("Paystack verify error:", errMsg);
    return { success: false, message: errMsg };
  }
};

module.exports = { createDedicatedAccount, verifyTransaction };
