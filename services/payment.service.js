const axios = require("axios");

const { getCustomerInitials } = require("../utils/helpers");

const {
  customerRepo,
  deliveryCustomerRepo,
  deliverySaleRepo,
  depositRepo,
  orderRepo,
} = require("../repositories");
const walletService = require("./wallet.service");
const { generateTicketForOrder } = require("./ticket.service");

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

const processPaystackPayment = async (paystackData, rawEventName = "manual_sync") => {
  const reference = paystackData?.reference || "";
  if (!reference) {
    return { success: false, message: "Missing reference in transaction data" };
  }

  // Idempotency check
  const existingDeposit = await depositRepo.findByReference(reference);
  const existingDeliverySale = await deliverySaleRepo.findByPaystackReference(reference);
  if (existingDeposit || existingDeliverySale) {
    return {
      success: true,
      alreadyProcessed: true,
      message: `Transaction reference ${reference} has already been recorded.`,
      deposit: existingDeposit,
      deliverySale: existingDeliverySale,
    };
  }

  // Verify transaction with Paystack
  const verification = await verifyTransaction(reference);
  if (!verification.success || verification.data?.status !== "success") {
    return {
      success: false,
      message: `Paystack transaction verification failed for reference: ${reference}`,
    };
  }

  const vData = verification.data;
  const amount = vData.amount / 100;
  if (amount <= 0) {
    return { success: false, message: `Verified amount is invalid or zero for reference: ${reference}` };
  }

  const accountNumber = (
    paystackData?.dedicated_account?.account_number ||
    paystackData?.authorization?.receiver_bank_account_number ||
    paystackData?.authorization?.receiver_bank_account ||
    paystackData?.receiver_account_number ||
    vData?.dedicated_account?.account_number ||
    vData?.authorization?.receiver_bank_account_number ||
    (Array.isArray(vData?.customer?.dedicated_accounts) && vData.customer.dedicated_accounts[0]?.account_number) ||
    ""
  ).toString().trim();

  const customerCode = (vData?.customer?.customer_code || paystackData?.customer?.customer_code || "").trim();
  const customerEmail = (vData?.customer?.email || paystackData?.customer?.email || "").trim();

  const paystackDetails = {
    transactionId: vData.id || null,
    domain: vData.domain || null,
    status: vData.status || null,
    reference: reference,
    amount: amount,
    currency: vData.currency || "NGN",
    channel: vData.channel || null,
    gatewayResponse: vData.gateway_response || null,
    message: vData.message || null,
    paidAt: vData.paid_at || null,
    createdAt: vData.created_at || null,
    fees: vData.fees != null ? vData.fees / 100 : null,
    senderBankName:
      paystackData?.authorization?.sender_bank ||
      vData.authorization?.sender_bank ||
      vData.authorization?.bank ||
      null,
    senderAccountNumber:
      paystackData?.authorization?.sender_bank_account_number ||
      vData.authorization?.sender_bank_account_number ||
      vData.authorization?.last4 ||
      null,
    senderName:
      paystackData?.authorization?.sender_name ||
      vData.authorization?.sender_name ||
      vData.authorization?.account_name ||
      null,
    senderCountry: paystackData?.authorization?.sender_country || null,
    senderNarration: paystackData?.authorization?.narration || null,
    receiverBankName: paystackData?.dedicated_account?.bank?.name || vData?.dedicated_account?.bank?.name || null,
    receiverAccountNumber: accountNumber,
    receiverAccountName: paystackData?.dedicated_account?.account_name || vData?.dedicated_account?.account_name || null,
    authorizationCode: vData.authorization?.authorization_code || null,
    bin: vData.authorization?.bin || null,
    last4: vData.authorization?.last4 || null,
    cardType: vData.authorization?.card_type || null,
    bank: vData.authorization?.bank || null,
    ipAddress: vData.ip_address || null,
    metadata: vData.metadata || null,
    paystackCustomerCode: customerCode || null,
    paystackCustomerEmail: customerEmail || null,
    rawEvent: rawEventName,
  };

  let customer = null;
  let deliveryCustomer = null;

  if (accountNumber) {
    customer = await customerRepo.findByVirtualAccount(accountNumber);
    if (!customer) {
      deliveryCustomer = await deliveryCustomerRepo.findByVirtualAccount(accountNumber);
    }
  }

  if (!customer && !deliveryCustomer && customerCode) {
    customer = await customerRepo.findByPaystackCustomerId(customerCode);
  }

  if (!customer && !deliveryCustomer && customerEmail) {
    customer = await customerRepo.findByEmail(customerEmail);
  }

  if (customer) {
    // Ledger row + balance update happen atomically, and the unique index on
    // deposits.reference makes a concurrent duplicate webhook a no-op.
    const creditResult = await walletService.credit({
      customerId: customer.id,
      amount,
      description: "Payment received via bank transfer",
      reference,
      paystackDetails,
    });

    if (creditResult.alreadyProcessed) {
      return {
        success: true,
        alreadyProcessed: true,
        message: creditResult.message,
        deposit: creditResult.deposit,
      };
    }

    // Automatically process unpaid orders using updated wallet balance
    const autoPaidOrders = await processUnpaidOrdersForCustomer(customer.id);

    return {
      success: true,
      customerType: "customer",
      customer: creditResult.customer,
      deposit: creditResult.deposit,
      amount: amount,
      reference: reference,
      autoPaidOrdersCount: autoPaidOrders.length,
    };
  } else if (deliveryCustomer) {
    let deliverySale = null;
    const pendingSale = await deliverySaleRepo.findPendingByCustomer(deliveryCustomer.id);

    if (pendingSale) {
      const previousPayment = Number(pendingSale.paymentAmount || 0);
      const newPaymentAmount = previousPayment + amount;
      const newBalance = Number(pendingSale.salesValue || 0) - newPaymentAmount;

      deliverySale = await deliverySaleRepo.update(pendingSale.id, {
        paymentAmount: String(newPaymentAmount),
        balance: String(newBalance),
        payerName: paystackDetails.senderName || pendingSale.payerName,
        bank: `Paystack DVA (${paystackDetails.receiverBankName || "Paystack"})`,
        dateOfPayment: paystackDetails.paidAt
          ? new Date(paystackDetails.paidAt).toISOString().split("T")[0]
          : new Date().toISOString().split("T")[0],
        depositStatus: newBalance <= 0 ? "paid" : "partial",
        paymentMethod: "paystack_dva",
        paystackReference: reference,
        paystackDetails: paystackDetails,
      });
    } else {
      deliverySale = await deliverySaleRepo.create({
        customerId: deliveryCustomer.id,
        customerName: deliveryCustomer.name,
        paymentAmount: String(amount),
        salesValue: "0",
        balance: "0",
        payerName: paystackDetails.senderName || "",
        bank: `Paystack DVA (${paystackDetails.receiverBankName || "Paystack"})`,
        dateOfPayment: paystackDetails.paidAt
          ? new Date(paystackDetails.paidAt).toISOString().split("T")[0]
          : new Date().toISOString().split("T")[0],
        depositStatus: "paid",
        paymentMethod: "paystack_dva",
        paystackReference: reference,
        paystackDetails: paystackDetails,
        enteredBy: "Paystack Webhook",
        remarks: `Auto-recorded from DVA payment. Sender: ${paystackDetails.senderName || "Unknown"}`,
      });
    }

    await deliveryCustomerRepo.update(deliveryCustomer.id, {
      lastTransactionDate: new Date(),
    });

    return {
      success: true,
      customerType: "deliveryCustomer",
      deliveryCustomer: deliveryCustomer,
      deliverySale: deliverySale,
      amount: amount,
      reference: reference,
    };
  } else {
    return {
      success: false,
      message: `No customer or delivery customer found matching virtual account '${accountNumber}', customer code '${customerCode}', or email '${customerEmail}'.`,
    };
  }
};

const processUnpaidOrdersForCustomer = async (customerId) => {
  const unpaidOrders = (await orderRepo.findUnpaidByCustomer(customerId)) || [];
  const processedOrders = [];

  for (const order of unpaidOrders) {
    const orderTotal = Number(order.totalAmount || 0);
    if (orderTotal <= 0) continue;

    // The hold is the sufficiency check: it either commits the funds under a
    // row lock or fails, so concurrent runs can't pay the same order twice
    // (unique hold per order) or spend the same money twice (locked balance).
    const holdResult = await walletService.placeHold({
      customerId,
      orderId: order.id,
      amount: orderTotal,
      description: `Auto-payment for Order ${order.orderNumber} (Wallet Balance)`,
    });

    if (!holdResult.success) {
      // alreadyHeld on an unpaid order means an earlier run placed the hold
      // and crashed before marking it paid — finish that job. An inactive
      // (released/converted) hold is history, not a claim; skip.
      if (!holdResult.alreadyHeld) continue;
      const existingHold = await walletService.findHoldByOrder(order.id);
      if (!existingHold || existingHold.status !== "active") continue;
    }

    await orderRepo.update(order.id, { paymentStatus: "Paid" });

    // Generate loading ticket so order automatically passes through
    try {
      await generateTicketForOrder(order.id);
      console.log(`Order ${order.orderNumber} automatically paid with wallet balance and ticket generated.`);
    } catch (tktErr) {
      console.error(`Failed to generate ticket for auto-paid order ${order.orderNumber}:`, tktErr.message);
    }

    processedOrders.push(order);
  }

  return processedOrders;
};

const processAllUnpaidOrders = async () => {
  const customerIds = await customerRepo.findIdsWithPositiveBalance();
  let totalProcessed = 0;
  for (const customerId of customerIds) {
    const processed = await processUnpaidOrdersForCustomer(customerId);
    totalProcessed += processed.length;
  }
  return totalProcessed;
};

module.exports = {
  createDedicatedAccount,
  verifyTransaction,
  processPaystackPayment,
  processUnpaidOrdersForCustomer,
  processAllUnpaidOrders,
};
