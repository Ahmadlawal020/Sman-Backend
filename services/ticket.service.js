const { db } = require("../config/db");
const { orderRepo, ticketRepo, customerRepo } = require("../repositories");
const { sendTicketEmail } = require("./email.service");
const { sendTicketSummarySMS } = require("./sms.service");
const { notify } = require("../notifications");

/**
 * consumer_truckticket (live) has no ticketNumber/qrCodeDataUrl/orderTruckId/
 * status columns at all — see repositories/ticket.repository.js's header
 * comment. It's keyed on (orderId, truckNumber) instead, with its own
 * ticketStatus enum (pending/generated/printed/loaded/completed) and no QR
 * backing whatsoever. Both functions below now write only columns that
 * actually exist; the QR code and a display "ticket number" are synthesised
 * in JS from the row's id/orderId rather than stored, since Sman's customer-
 * facing digital ticket (this file) is a value-add layered on top of a live
 * table Django itself never gave a code or QR image.
 */

const displayTicketNumber = (orderId, truckNumber) => `TCK-${orderId}-${truckNumber}`;

const buildQrCodeDataUrl = async (ticketId) => {
  const QRCode = require("qrcode");
  const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
  return QRCode.toDataURL(`${clientUrl}/ticket/details?id=${ticketId}`, { margin: 1, width: 300 });
};

/**
 * Issue the ticket for a single truck load, idempotently, inside the caller's
 * transaction (the "mark loaded" step). One consumer_truckticket row per
 * (order, truckNumber) — `load` is a consumer_truckallocation row (see
 * repositories/orderTruck.repository.js), so its plate/driver copy straight
 * across. Returns the existing ticket if this load already has one, so a
 * repeated load call is safe.
 */
const generateTicketForTruck = async (order, load, tx = db) => {
  const existing = await ticketRepo.findByOrderAndTruckNumber(order.id, load.truckNumber, tx);
  if (existing) return existing;

  const now = new Date().toISOString();
  return ticketRepo.create(
    {
      orderId: order.id,
      truckNumber: load.truckNumber,
      quantityLitres: String(load.quantity),
      driverName: load.driverName || null,
      plateNumber: load.plateNumber || null,
      ticketStatus: "pending",
      createdAt: now,
      updatedAt: now,
    },
    tx
  );
};

const generateTicketForOrder = async (orderIdOrDoc) => {
  try {
    let order;
    if (typeof orderIdOrDoc === "object" && orderIdOrDoc.id) {
      order = orderIdOrDoc;
    } else {
      order = await orderRepo.findByIdFull(orderIdOrDoc);
    }

    if (!order) {
      throw new Error("Order not found");
    }

    // The order-level digital ticket always occupies truckNumber 1 — a single
    // slot covering the whole order's quantity, distinct from the per-truck
    // tickets the gate/loading flow issues later via generateTicketForTruck
    // (which use the real declared truckNumbers for a pickup order).
    const TRUCK_NUMBER = 1;
    const existingTicket = await ticketRepo.findByOrderAndTruckNumber(order.id, TRUCK_NUMBER);
    if (existingTicket) {
      return { success: true, ticket: existingTicket, message: "Ticket already generated" };
    }

    const now = new Date().toISOString();
    const savedTicket = await ticketRepo.create({
      orderId: order.id,
      truckNumber: TRUCK_NUMBER,
      quantityLitres: String(order.quantity),
      ticketStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });

    const qrCodeDataUrl = await buildQrCodeDataUrl(savedTicket.id);
    const updatedTicket = await ticketRepo.update(savedTicket.id, { ticketStatus: "generated" });
    const ticketNumber = displayTicketNumber(order.id, TRUCK_NUMBER);

    const customer = await customerRepo.findById(order.customerId);
    if (!customer) {
      throw new Error("Customer not found for this order");
    }

    const ticketData = {
      ticketNumber,
      qrCodeDataUrl,
      customerName: customer.name,
      companyName: customer.companyName || "",
      customerPhone: customer.phone || "",
      customerEmail: customer.email || "",
      productName: order.productName || "N/A",
      productSku: order.productSku || "",
      productCategory: order.productCategory || "",
      quantity: order.quantity,
      unit: order.productUnit || "Liters",
      unitPrice: order.price,
      orderNumber: order.orderNumber,
      orderDate: order.createdAt,
      depotName: order.depotName || "N/A",
      depotCode: order.depotCode || "",
      depotAddress: order.depotAddress || "",
      state: order.stateName || "",
      totalAmount: order.totalPrice,
      deliveryType: order.deliveryType,
      virtualAccountNumber: order.paidToAccountNumber || "",
      virtualAccountBank: order.paidToBankName || "",
    };

    if (customer.email) {
      try {
        await sendTicketEmail(customer.email, ticketData);
      } catch (emailErr) {
        console.error("Failed to send ticket email:", emailErr.message);
      }
    }

    if (customer.phone) {
      try {
        await sendTicketSummarySMS(customer.phone, ticketData);
      } catch (smsErr) {
        console.error("Failed to send ticket SMS:", smsErr.message);
      }
    }

    // The QR-code email and its SMS above are untouched. This adds the inbox
    // row and push so the ticket is reachable in the app rather than only in
    // whichever inbox the customer read it from — the catalog entry is
    // APP_ONLY so nothing here is sent twice.
    notify("ticket.issued", {
      to: { customer },
      data: {
        ticketId: updatedTicket?.id,
        ticketNumber: ticketData.ticketNumber,
        orderId: order.id,
        orderNumber: order.orderNumber,
        reference: order.orderNumber,
        customerName: customer.name,
        deliveryType: order.deliveryType,
        depotName: order.depotName || "",
      },
    });

    return { success: true, ticket: updatedTicket };
  } catch (error) {
    console.error("Error in generateTicketForOrder:", error);
    return { success: false, error: error.message };
  }
};

module.exports = { generateTicketForOrder, generateTicketForTruck };
