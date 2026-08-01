const axios = require("axios");
const { getCustomerInitials } = require("../utils/helpers");
const { toSmsRecipient } = require("../utils/phone");

// Termii v3 API Configuration
const TERMII_BASE_URL = process.env.TERMII_BASE_URL || "https://v3.api.termii.com";
const TERMII_API_KEY = process.env.TERMII_API_KEY;
const TERMII_SENDER_ID = process.env.TERMII_SENDER_ID || "Soroman";
const SMS_ENABLED = process.env.SMS_ENABLED !== "false";
const WHATSAPP_DEVICE_ID = process.env.WHATSAPP_DEVICE_ID || "036ccd6b-c655-4c2e-a47b-903898e55732";
const WHATSAPP_TEMPLATE_ID = process.env.WHATSAPP_TEMPLATE_ID || "ffb23b37-8475-4571-8e3b-7f55e4bc6d54";

// Was a second hand-rolled Nigeria-only normaliser that agreed with
// utils/helpers by coincidence. Termii wants E.164 digits without the `+`,
// which is a rendering of one parse rather than a separate parser.
const formatPhoneForTermii = toSmsRecipient;

const CHANNELS = {
  GENERIC: "generic",
  DND: "dnd",
};

const sendSMSTermii = async (phone, sms, channel = CHANNELS.GENERIC) => {
  if (!SMS_ENABLED) {
    console.log("[SMS] SMS sending is disabled");
    return { success: true };
  }

  if (!TERMII_API_KEY) {
    console.error("[SMS] TERMII_API_KEY is not configured");
    return { success: false, message: "SMS API key not configured" };
  }

  const response = await axios.post(
    `${TERMII_BASE_URL}/sms/send`,
    {
      to: formatPhoneForTermii(phone),
      from: TERMII_SENDER_ID,
      sms,
      type: "plain",
      channel,
      api_key: TERMII_API_KEY,
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

const sendDangoteDeliveryOrderSMS = async (phone, orderData) => {
  const { requestNumber, customerName, product, quantity, quantityUnit, totalAmount, accountNumber, bankName, accountName } = orderData;

  const formattedAmount = new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(totalAmount);

  const customerInitials = getCustomerInitials(customerName);
  const formattedAccountName = accountName || `SOROMANNIGERI/ ${customerInitials}`;

  const sms = `Hi ${customerName}, your Dangote delivery order ${requestNumber} for ${quantity?.toLocaleString()} ${quantityUnit} of ${product} (${formattedAmount}) has been approved. Pay to: ${bankName} - ${accountNumber} (${formattedAccountName}). Thank you for choosing Soroman!`;

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

module.exports = { sendSMSTermii, sendOrderSummarySMS, sendTicketSummarySMS, sendDangoteDeliveryOrderSMS, CHANNELS };
