const axios = require("axios");
const { getCustomerInitials } = require("../utils/helpers");
const { toSmsRecipient } = require("../utils/phone");

// Termii v3 API. Config is read at call time inside sendSMSTermii — not frozen
// at module load — so a deploy or a test can override the key, sender, or
// enabled flag per-send, and a missing key is caught on each attempt.

// Was a second hand-rolled Nigeria-only normaliser that agreed with
// utils/helpers by coincidence. Termii wants E.164 digits without the `+`,
// which is a rendering of one parse rather than a separate parser.
const formatPhoneForTermii = toSmsRecipient;

const CHANNELS = {
  GENERIC: "generic",
  DND: "dnd",
};

const sendSMSTermii = async (phone, sms, channel = CHANNELS.GENERIC) => {
  if (process.env.SMS_ENABLED === "false") {
    console.log("[SMS] SMS sending is disabled");
    return { success: true };
  }

  const apiKey = process.env.TERMII_API_KEY;
  if (!apiKey) {
    console.error("[SMS] TERMII_API_KEY is not configured");
    return { success: false, message: "SMS API key not configured" };
  }

  const response = await axios.post(
    // Termii's send endpoint is /api/sms/send. The bare /sms/send path 404s,
    // which is what surfaced as "Termii ... channel error ... status code 404".
    `${process.env.TERMII_BASE_URL || "https://v3.api.termii.com"}/api/sms/send`,
    {
      to: formatPhoneForTermii(phone),
      from: process.env.TERMII_SENDER_ID || "Soroman",
      sms,
      type: "plain",
      channel,
      api_key: apiKey,
    },
    { headers: { "Content-Type": "application/json" } }
  );

  if (response.data.message === "Successfully Sent" || response.data.code === "ok") {
    return { success: true };
  }

  return { success: false, message: response.data.message || "SMS sending failed" };
};

const sendOrderSummarySMS = async (phone, orderData) => {
  const { orderNumber, customerName, product, quantity, unit, totalAmount, accountNumber, bankName, accountName } = orderData;

  const formattedAmount = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(totalAmount);

  const customerInitials = getCustomerInitials(customerName);
  const formattedAccountName = accountName || `SOROMAN/${customerInitials}`;
  const sms = `Dear ${customerName}, your order ${orderNumber} for ${quantity?.toLocaleString()}${unit ? ` ${unit}` : ""} of ${product} (${formattedAmount}) has been received. Pay to: ${bankName} - ${accountNumber} (Account Name: ${formattedAccountName}). Thank you for choosing Soroman!`;

  // Try generic (transactional) channel first, fall back to dnd
  for (const channel of [CHANNELS.GENERIC, CHANNELS.DND]) {
    try {
      const result = await sendSMSTermii(phone, sms, channel);
      if (result.success) {
        return { success: true, message: "SMS sent successfully" };
      }
      console.warn(`Termii ${channel} channel failed:`, result.message);
    } catch (error) {
      const errMsg =
        error.response?.data?.message || error.message || "Termii SMS error";
      console.warn(`Termii ${channel} channel error:`, errMsg);
    }
  }

  return { success: false, message: "All Termii channels failed" };
};

const sendTicketSummarySMS = async (phone, ticketData) => {
  const { ticketNumber, customerName, productName, quantity, unit, depotName, deliveryType, orderNumber } = ticketData;

  // Delivery orders have nothing to "present at the depot" — the same order-level
  // ticket exists so the load can pass the gate, but the buyer isn't collecting
  // it. Telling a delivery customer to redeem a pickup QR is wrong, so the copy
  // branches on deliveryType.
  const sms =
    deliveryType === "delivery"
      ? `Dear ${customerName}, your order ${orderNumber || ticketNumber} for ${quantity?.toLocaleString()} ${unit} of ${productName} from ${depotName || "the depot"} is confirmed and being prepared for delivery. We'll keep you updated. Thank you for choosing Soroman!`
      : `Dear ${customerName}, your pickup ticket ${ticketNumber} for ${quantity?.toLocaleString()} ${unit} of ${productName} at ${depotName || "depot"} has been generated. Thank you for choosing Soroman!`;

  for (const channel of [CHANNELS.GENERIC, CHANNELS.DND]) {
    try {
      const result = await sendSMSTermii(phone, sms, channel);
      if (result.success) {
        return { success: true, message: "Ticket SMS sent successfully" };
      }
    } catch (error) {
      console.warn(`Termii ${channel} channel error during ticket SMS:`, error.message);
    }
  }
  return { success: false, message: "All Termii channels failed for ticket SMS" };
};

const sendDangoteDeliveryOrderSMS = async (phone, orderData) => {
  const { requestNumber, customerName, product, quantity, quantityUnit, totalAmount, accountNumber, bankName, accountName } = orderData;

  const formattedAmount = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(totalAmount);

  const customerInitials = getCustomerInitials(customerName);
  const formattedAccountName = accountName || `SOROMAN/${customerInitials}`;

  const sms = `Dear ${customerName}, your Dangote delivery order ${requestNumber} for ${quantity?.toLocaleString()} ${quantityUnit} of ${product} (${formattedAmount}) has been approved. Pay to: ${bankName} - ${accountNumber} (${formattedAccountName}). Thank you for choosing Soroman!`;

  for (const channel of [CHANNELS.GENERIC, CHANNELS.DND]) {
    try {
      const result = await sendSMSTermii(phone, sms, channel);
      if (result.success) {
        return { success: true, message: "Dangote delivery order SMS sent successfully" };
      }
      console.warn(`Termii ${channel} channel failed:`, result.message);
    } catch (error) {
      const errMsg = error.response?.data?.message || error.message || "Termii SMS error";
      console.warn(`Termii ${channel} channel error:`, errMsg);
    }
  }

  return { success: false, message: "All Termii channels failed" };
};

const sendLpgOrderSMS = async (phone, orderData) => {
  const { requestNumber, customerName, cylinderSizeKg, cylinderQuantity, totalAmount, accountNumber, bankName, accountName } = orderData;

  const formattedAmount = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(totalAmount);

  const customerInitials = getCustomerInitials(customerName);
  const formattedAccountName = accountName || `SOROMAN/${customerInitials}`;

  const sms = `Dear ${customerName}, your LPG order ${requestNumber} for ${cylinderQuantity}x ${cylinderSizeKg}Kg cylinders (${formattedAmount}) has been approved. Pay to: ${bankName} - ${accountNumber} (${formattedAccountName}). Thank you for choosing Soroman!`;

  for (const channel of [CHANNELS.GENERIC, CHANNELS.DND]) {
    try {
      const result = await sendSMSTermii(phone, sms, channel);
      if (result.success) {
        return { success: true, message: "LPG order SMS sent successfully" };
      }
      console.warn(`Termii ${channel} channel failed:`, result.message);
    } catch (error) {
      const errMsg = error.response?.data?.message || error.message || "Termii SMS error";
      console.warn(`Termii ${channel} channel error:`, errMsg);
    }
  }

  return { success: false, message: "All Termii channels failed" };
};

const sendOrderExpiredSMS = async (phone, { orderNumber, customerName }) => {
  const name = customerName ? `Dear ${customerName}, ` : "";
  const sms = `${name}your Soroman order ${orderNumber} has expired because payment wasn't received in time. The price is no longer held — place a new order at today's prices whenever you're ready.`;

  for (const channel of [CHANNELS.GENERIC, CHANNELS.DND]) {
    try {
      const result = await sendSMSTermii(phone, sms, channel);
      if (result.success) return { success: true, message: "SMS sent successfully" };
      console.warn(`Termii ${channel} channel failed:`, result.message);
    } catch (error) {
      const errMsg = error.response?.data?.message || error.message || "Termii SMS error";
      console.warn(`Termii ${channel} channel error:`, errMsg);
    }
  }
  return { success: false, message: "All Termii channels failed" };
};

const sendDangoteOrderExpiredSMS = async (phone, { requestNumber, customerName }) => {
  const name = customerName ? `Hi ${customerName}, ` : "";
  const sms = `${name}your Dangote delivery order ${requestNumber} has expired because payment wasn't received in time. The price is no longer held — submit a new request at today's prices whenever you're ready.`;

  for (const channel of [CHANNELS.GENERIC, CHANNELS.DND]) {
    try {
      const result = await sendSMSTermii(phone, sms, channel);
      if (result.success) return { success: true, message: "SMS sent successfully" };
      console.warn(`Termii ${channel} channel failed:`, result.message);
    } catch (error) {
      const errMsg = error.response?.data?.message || error.message || "Termii SMS error";
      console.warn(`Termii ${channel} channel error:`, errMsg);
    }
  }
  return { success: false, message: "All Termii channels failed" };
};

const sendLpgOrderExpiredSMS = async (phone, { requestNumber, customerName }) => {
  const name = customerName ? `Hi ${customerName}, ` : "";
  const sms = `${name}your LPG cooking gas order ${requestNumber} has expired because payment wasn't received in time. The price is no longer held — submit a new order at today's prices whenever you're ready.`;

  for (const channel of [CHANNELS.GENERIC, CHANNELS.DND]) {
    try {
      const result = await sendSMSTermii(phone, sms, channel);
      if (result.success) return { success: true, message: "SMS sent successfully" };
      console.warn(`Termii ${channel} channel failed:`, result.message);
    } catch (error) {
      const errMsg = error.response?.data?.message || error.message || "Termii SMS error";
      console.warn(`Termii ${channel} channel error:`, errMsg);
    }
  }
  return { success: false, message: "All Termii channels failed" };
};

module.exports = { sendSMSTermii, sendOrderSummarySMS, sendTicketSummarySMS, sendDangoteDeliveryOrderSMS, sendLpgOrderSMS, sendOrderExpiredSMS, sendDangoteOrderExpiredSMS, sendLpgOrderExpiredSMS, CHANNELS };
