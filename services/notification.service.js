const { onEvent } = require("./events");
const { sendSMSTermii, sendDangoteDeliveryOrderSMS } = require("./sms.service");
const {
  sendDangoteRequestReceivedEmail,
  sendDangoteOrderConfirmedEmail,
} = require("./email.service");
const { dangoteDeliveryOrderRepo, customerRepo } = require("../repositories");

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

  // ── Dangote delivery ────────────────────────────────────────────────────
  // Every customer-facing moment reacts to one status-change event. The desk
  // and portal never send messages themselves; they just move the status.
  const DANGOTE_NOTIFY = ["UNDER_REVIEW", "NEEDS_CHANGES", "APPROVED", "REJECTED", "DISPATCHED", "COMPLETED"];
  onEvent("dangote_delivery.status_changed", async ({ orderId, to, note }) => {
    if (!DANGOTE_NOTIFY.includes(to)) return;
    const order = await dangoteDeliveryOrderRepo.findByIdFull(orderId).catch(() => null);
    if (!order) return;
    const { customerEmail, customerPhone, customerName, requestNumber } = order;

    switch (to) {
      case "UNDER_REVIEW":
        if (customerEmail) {
          await sendDangoteRequestReceivedEmail(customerEmail, {
            requestNumber,
            customerName,
            product: order.product,
            quantity: order.quantity,
            quantityUnit: order.quantityUnit,
            deliveryAddress: order.deliveryAddress,
            deliveryState: order.deliveryState,
          }).catch((e) => console.error("[notify] dangote received email:", e.message));
        }
        await notifySMS(
          customerPhone,
          `Soroman: your Dangote delivery request ${requestNumber} has been received and is under review.`
        );
        break;

      case "APPROVED":
        if (customerEmail) {
          await sendDangoteOrderConfirmedEmail(customerEmail, {
            requestNumber,
            customerName,
            companyName: order.companyName || "",
            customerPhone,
            product: order.product,
            quantity: order.quantity,
            quantityUnit: order.quantityUnit,
            pricePerUnit: Number(order.unitPrice || 0),
            deliveryPrice: Number(order.deliveryPrice || 0),
            totalAmount: Number(order.totalAmount || 0),
            deliveryAddress: order.deliveryAddress,
            deliveryState: order.deliveryState,
            expectedArrivalDate: order.expectedArrivalDate || "",
            accountNumber: order.virtualAccountNumber,
            bankName: order.virtualAccountBank,
            accountName: order.virtualAccountName,
          }).catch((e) => console.error("[notify] dangote quote email:", e.message));
        }
        if (customerPhone) {
          await sendDangoteDeliveryOrderSMS(customerPhone, {
            requestNumber,
            customerName,
            product: order.product,
            quantity: order.quantity,
            quantityUnit: order.quantityUnit,
            totalAmount: Number(order.totalAmount || 0),
            accountNumber: order.virtualAccountNumber,
            bankName: order.virtualAccountBank,
            accountName: order.virtualAccountName,
          }).catch((e) => console.error("[notify] dangote quote sms:", e.message));
        }
        break;

      case "NEEDS_CHANGES":
        await notifySMS(
          customerPhone,
          `Soroman: your Dangote delivery request ${requestNumber} needs an update before we can approve it.` +
            (note ? ` ${note}` : "")
        );
        break;

      case "REJECTED":
        await notifySMS(
          customerPhone,
          `Soroman: your Dangote delivery request ${requestNumber} was not approved.` +
            (note ? ` Reason: ${note}` : "")
        );
        break;

      case "DISPATCHED":
        await notifySMS(customerPhone, `Soroman: your Dangote delivery ${requestNumber} has been dispatched.`);
        break;

      case "COMPLETED":
        await notifySMS(
          customerPhone,
          `Soroman: your Dangote delivery ${requestNumber} is complete. Thank you for choosing Soroman!`
        );
        break;
    }
  });

  onEvent("customer_license.verified", async ({ customerId }) => {
    const c = await customerRepo.findById(customerId).catch(() => null);
    await notifySMS(
      c?.phone,
      "Soroman: your DPR/NUPRC license has been verified — it's ready to use on your Dangote delivery orders."
    );
  });

  onEvent("customer_license.rejected", async ({ customerId, comment }) => {
    const c = await customerRepo.findById(customerId).catch(() => null);
    await notifySMS(
      c?.phone,
      "Soroman: your DPR/NUPRC license wasn't accepted." +
        (comment ? ` Reason: ${comment}.` : "") +
        " Please upload a valid copy."
    );
  });
};

module.exports = { notifySMS, registerNotificationListeners };
