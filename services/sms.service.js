const axios = require("axios");
const { getCustomerInitials } = require("../utils/helpers");

const TERMII_BASE_URL = "https://api.ng.termii.com/api";

function formatPhoneForTermii(phone) {
  if (!phone) return "";
  let cleaned = phone.replace(/[\s\-\(\)]/g, "");
  if (cleaned.startsWith("+")) cleaned = cleaned.slice(1);
  if (cleaned.startsWith("0")) cleaned = "234" + cleaned.slice(1);
  if (/^[789]\d{9}$/.test(cleaned)) cleaned = "234" + cleaned;
  return cleaned;
}

const CHANNELS = {
  GENERIC: "generic",
  DND: "dnd",
};

const sendSMSTermii = async (phone, sms, channel = CHANNELS.GENERIC) => {
  const response = await axios.post(
    `${TERMII_BASE_URL}/sms/send`,
    {
      to: formatPhoneForTermii(phone),
      from: process.env.TERMII_SENDER_ID || "SOROMAN",
      sms,
      type: "plain",
      channel,
      api_key: process.env.TERMII_API_KEY,
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
  const formattedAccountName = accountName || `SOROMANNIGERI/ ${customerInitials}`;
  const sms = `Hi ${customerName}, your order ${orderNumber} for ${quantity?.toLocaleString()}${unit ? ` ${unit}` : ""} of ${product} (${formattedAmount}) has been received. Pay to: ${bankName} - ${accountNumber} (Account Name: ${formattedAccountName}). Thank you for choosing Soroman!`;

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
  const { ticketNumber, customerName, productName, quantity, unit, depotName } = ticketData;

  const sms = `Hi ${customerName}, your pickup ticket ${ticketNumber} for ${quantity?.toLocaleString()} ${unit} of ${productName} at ${depotName || "depot"} has been generated. Present QR code in your email to redeem. Thank you for choosing Soroman!`;

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

module.exports = { sendOrderSummarySMS, sendTicketSummarySMS };
