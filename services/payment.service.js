const axios = require("axios");

const { getCustomerInitials } = require("../utils/helpers");

const {
  customerRepo,
  deliveryCustomerRepo,
  deliverySaleRepo,
  depositRepo,
  orderRepo,
} = require("../repositories");
const { generateTicketForOrder } = require("./ticket.service");
const orderStatus = require("./orderStatus.service");

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
    const newDeposit = await depositRepo.create({
      customerId: customer.id,
      amount: String(amount),
      type: "credit",
      description: "Payment received via bank transfer",
      reference: reference,
      balanceAfter: String(Number(customer.balance || 0) + amount),
      paystackDetails: paystackDetails,
    });

    const previousDeposit = Number(customer.deposit || 0);
    await customerRepo.updateDeposit(customer.id, amount, previousDeposit);

    // Automatically process unpaid orders using updated wallet balance
    const autoPaidOrders = await processUnpaidOrdersForCustomer(customer.id);

    return {
      success: true,
      customerType: "customer",
      customer: customer,
      deposit: newDeposit,
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
  const customer = await customerRepo.findById(customerId);
  if (!customer) return [];

  let currentBalance = Number(customer.balance || 0);
  if (currentBalance <= 0) return [];

  const unpaidOrders = (await orderRepo.findUnpaidByCustomer(customerId)) || [];
  const processedOrders = [];

  for (const order of unpaidOrders) {
    const orderTotal = Number(order.totalAmount || 0);
    if (orderTotal <= 0) continue;

    if (currentBalance >= orderTotal) {
      // 1. Debit FIRST, guarded. Marking the order Paid before taking the
      //    money means a lost race leaves a Paid order that was never funded.
      const debited = await customerRepo.debitBalance(customerId, orderTotal);
      if (!debited) {
        // A concurrent order or sweep spent the balance. Leave this order
        // unpaid; it will be picked up next time funds arrive.
        console.warn(
          `[settlement] insufficient funds for order ${order.orderNumber} — skipped`
        );
        break;
      }
      currentBalance = Number(debited.balance);

      // 2. Now that the money is taken, mark the order Paid and drive the
      //    lifecycle Pending→Paid through the state machine (system actor) so it
      //    reaches the "Paid" stage release requires and writes an order.paid
      //    audit row. Guarded on the current status so a settled order that has
      //    already moved on (or was cancelled) is left untouched, not errored.
      await orderRepo.update(order.id, { paymentStatus: "Paid" });
      if (order.status === "Pending") {
        try {
          await orderStatus.transition(order.id, "Paid", {
            actor: { type: "system" },
            action: "order.paid",
            set: { paymentConfirmedAt: new Date() },
            metadata: { via: "settlement", amount: String(orderTotal) },
          });
        } catch (stErr) {
          console.error(`Failed to advance order ${order.orderNumber} to Paid:`, stErr.message);
        }
      }

      // 3. Record debit deposit entry for accounting
      try {
        await depositRepo.create({
          customerId,
          amount: String(orderTotal),
          type: "debit",
          description: `Auto-payment for Order ${order.orderNumber} (Wallet Balance)`,
          balanceAfter: String(currentBalance),
        });
      } catch (depErr) {
        console.error("Failed to record debit deposit for auto-paid order:", depErr.message);
      }

      // 4. Generate loading ticket so order automatically passes through
      try {
        await generateTicketForOrder(order.id);
        console.log(`Order ${order.orderNumber} automatically paid with wallet balance and ticket generated.`);
      } catch (tktErr) {
        console.error(`Failed to generate ticket for auto-paid order ${order.orderNumber}:`, tktErr.message);
      }

      processedOrders.push(order);
    }
  }

  return processedOrders;
};

/**
 * Settle every unpaid order that the customer's wallet can cover.
 *
 * Previously called findAll({ limit: 1000 }) — which clamps to 100 — so it
 * silently covered only the hundred most recently created customers. The
 * `limit: 1000` at the call site read as deliberate coverage, which is exactly
 * why nobody looked again.
 *
 * Both counts are logged: a sweep that considers 0 customers and a sweep that
 * settles 0 orders look identical in the return value, and only one of them is
 * a problem.
 */
const processAllUnpaidOrders = async () => {
  const funded = await customerRepo.findWithPositiveBalance();

  let totalProcessed = 0;
  for (const cust of funded) {
    const processed = await processUnpaidOrdersForCustomer(cust.id);
    totalProcessed += processed.length;
  }

  console.log(
    `[settlement] considered ${funded.length} customer(s) with a balance; settled ${totalProcessed} order(s)`
  );
  return totalProcessed;
};

module.exports = {
  createDedicatedAccount,
  verifyTransaction,
  processPaystackPayment,
  processUnpaidOrdersForCustomer,
  processAllUnpaidOrders,
};
