const { onEvent } = require("./events");
const { sendSMSTermii } = require("./sms.service");

// Notifications are consumers of the event bus, never callers inside business
// flows. Each subscription below maps a business event to the outbound
// messages it deserves. Swapping Termii for another provider, or adding
// WhatsApp/push, happens here — nowhere else.

const notifySMS = async (phone, message) => {
  if (!phone) return { success: false, message: "No phone number" };
  try {
    return await sendSMSTermii(phone, message);
  } catch (err) {
    console.error("[notify] SMS failed:", err.message);
    return { success: false, message: err.message };
  }
};

const registerNotificationListeners = () => {
  onEvent("delivery.released", async ({ allocation, customerPhone }) => {
    if (!customerPhone) return;
    await notifySMS(
      customerPhone,
      `Soroman: your delivery ${allocation?.allocationCode || ""} has been released. ` +
        `Truck ${allocation?.truckNumber || "TBA"}, ${Number(allocation?.quantityAllocated || 0).toLocaleString()}L.`
    );
  });

  onEvent("daily_report.approved", async ({ report, submitterPhone }) => {
    if (!submitterPhone) return;
    await notifySMS(
      submitterPhone,
      `Soroman: your daily report for ${report?.location || ""} (${report?.reportDate || ""}) was approved.`
    );
  });

  onEvent("daily_report.rejected", async ({ report, submitterPhone, comment }) => {
    if (!submitterPhone) return;
    await notifySMS(
      submitterPhone,
      `Soroman: your daily report for ${report?.location || ""} (${report?.reportDate || ""}) was rejected.` +
        (comment ? ` Reason: ${comment}` : "")
    );
  });
};

module.exports = { notifySMS, registerNotificationListeners };
