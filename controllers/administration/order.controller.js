const asyncHandler = require("express-async-handler");
const { v4: uuidv4 } = require("uuid");
const { orderRepo, customerRepo, depotRepo, productRepo, pfiRepo, depositRepo } = require("../../repositories");
const { db } = require("../../config/db");
const { createDedicatedAccount } = require("../../services/payment.service");
const { sendOrderInvoiceEmail } = require("../../services/email.service");
const { sendOrderSummarySMS } = require("../../services/sms.service");
const { findPfiForOrder } = require("../../services/pfi.service");
const { generateTicketForOrder } = require("../../services/ticket.service");
const { getCustomerInitials } = require("../../utils/helpers");

const getOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, search, status, customer, dateFrom, dateTo } = req.query;

  const result = await orderRepo.findAll({
    search,
    status,
    customer,
    dateFrom,
    dateTo,
    page,
    limit,
  });

  res.json({ success: true, data: result });
});

const getOrderById = asyncHandler(async (req, res) => {
  const order = await orderRepo.findByIdFull(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }

  res.json({ success: true, data: { order } });
});

const createOrder = asyncHandler(async (req, res) => {
  const {
    customer: customerId, state, depot: depotId,
    product: productId, quantity, deliveryType,
  } = req.body;

  if (!customerId || !state || !depotId || !productId || !quantity || !deliveryType) {
    return res.status(400).json({
      success: false,
      message: "Please fill in all required fields to place the order",
    });
  }

  const customer = await customerRepo.findById(customerId);
  if (!customer) {
    return res.status(404).json({ success: false, message: "Customer not found" });
  }

  // Ensure customer has a dedicated virtual account
  let virtualAccountNumber = customer.virtualAccountNumber || "";
  let virtualAccountBank = customer.virtualAccountBank || "";
  let virtualAccountName = customer.virtualAccountName || "";

  if (!virtualAccountNumber) {
    const accountResult = await createDedicatedAccount(customer);
    if (accountResult.success) {
      virtualAccountNumber = accountResult.data.accountNumber;
      virtualAccountBank = accountResult.data.bankName;
      virtualAccountName = accountResult.data.accountName || `SOROMANNIGERI/ ${getCustomerInitials(customer.name)}`;
      const updateData = {
        virtualAccountNumber,
        virtualAccountBank,
        virtualAccountName,
      };
      if (accountResult.data.paystackCustomerId) {
        updateData.paystackCustomerId = accountResult.data.paystackCustomerId;
      }
      await customerRepo.update(customerId, updateData);
    } else {
      return res.status(400).json({
        success: false,
        message: "Customer has no dedicated payment account and one could not be generated. Please try again or contact support.",
      });
    }
  } else if (!virtualAccountName) {
    virtualAccountName = `SOROMANNIGERI/ ${getCustomerInitials(customer.name)}`;
    await customerRepo.update(customerId, { virtualAccountName });
  }

  const depot = await depotRepo.findById(depotId);
  if (!depot) {
    return res.status(404).json({ success: false, message: "Depot not found" });
  }

  // Server-side pricing
  const priceEntry = await depotRepo.getProductPrice(depotId, productId);
  if (!priceEntry || Number(priceEntry.currentPrice) <= 0) {
    return res.status(400).json({
      success: false,
      message: "No price configured for this product at this depot",
    });
  }

  const serverPrice = Number(priceEntry.currentPrice);
  const totalAmount = serverPrice * Number(quantity);

  // Find active PFIs
  const { selectedPfi: pfiDoc, totalAvailableStock } = await findPfiForOrder(depotId, productId, quantity);

  if (!pfiDoc) {
    if (totalAvailableStock < Number(quantity)) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock in depot. Total active PFI stock: ${totalAvailableStock.toLocaleString()} Litres`,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock in any single active PFI. Maximum available in a single PFI is less than the requested ${Number(quantity).toLocaleString()} Litres`,
      });
    }
  }

  // Atomic PFI stock reservation
  const updatedPfi = await pfiRepo.reserveStock(pfiDoc.id, Number(quantity));
  if (!updatedPfi) {
    return res.status(400).json({
      success: false,
      message: "Insufficient stock in the selected PFI (may have been claimed by another order)",
    });
  }

  // Check if PFI is now finished
  await pfiRepo.markFinishedIfComplete(updatedPfi.id);

  const orderNumber = `ORD-${uuidv4().replace(/-/g, "").slice(0, 12).toUpperCase()}`;

  // Check wallet balance
  const isPaidWithWallet = Number(customer.balance || 0) >= totalAmount;

  // Create order
  const order = await orderRepo.create({
    orderNumber,
    customerId,
    state,
    depotId,
    productId,
    pfiId: updatedPfi.id,
    quantity: Number(quantity),
    price: String(serverPrice),
    totalAmount: String(totalAmount),
    deliveryType,
    status: "Pending",
    paymentStatus: isPaidWithWallet ? "Paid" : "Unpaid",
    virtualAccountNumber,
    virtualAccountBank,
    virtualAccountName,
  });

  // If paid with wallet, deduct balance
  if (isPaidWithWallet) {
    await customerRepo.updateBalance(customerId, -totalAmount);

    try {
      await depositRepo.create({
        customerId,
        amount: String(totalAmount),
        type: "debit",
        description: `Payment for Order ${orderNumber} (Wallet Balance)`,
        balanceAfter: String(Number(customer.balance || 0) - totalAmount),
      });
    } catch (depErr) {
      console.error("Failed to record wallet payment debit deposit:", depErr.message);
    }
  }

  // Decrement depot product capacity
  await depotRepo.decrementProductCapacity(depotId, productId, Number(quantity));

  // Generate loading ticket if paid immediately
  if (order.paymentStatus === "Paid") {
    try {
      await generateTicketForOrder(order.id);
    } catch (ticketErr) {
      console.error("Failed to generate ticket on instant wallet payment:", ticketErr.message);
    }
  }

  // Populate for response
  const fullOrder = await orderRepo.findByIdFull(order.id);

  // Send invoice email
  if (customer.email) {
    try {
      await sendOrderInvoiceEmail(customer.email, {
        orderNumber,
        orderDate: order.createdAt,
        customerName: customer.name,
        companyName: customer.companyName,
        customerPhone: customer.phone,
        product: fullOrder.productName || "N/A",
        sku: fullOrder.productSku || "",
        quantity: order.quantity,
        unit: fullOrder.productUnit || "Liters",
        price: order.price,
        totalAmount: order.totalAmount,
        deliveryType: order.deliveryType,
        depotName: depot.name,
        depotCode: depot.code,
        state: order.state,
        accountNumber: virtualAccountNumber,
        bankName: virtualAccountBank,
        accountName: virtualAccountName,
      });
    } catch (emailErr) {
      console.error("Failed to send invoice email:", emailErr.message);
    }
  }

  // Send SMS
  let smsSent = false;
  try {
    const smsResult = await sendOrderSummarySMS(customer.phone, {
      orderNumber,
      customerName: customer.name,
      product: fullOrder.productName || "N/A",
      quantity: order.quantity,
      unit: fullOrder.productUnit || "Liters",
      totalAmount: order.totalAmount,
      accountNumber: virtualAccountNumber,
      bankName: virtualAccountBank,
      accountName: virtualAccountName,
    });
    smsSent = smsResult.success;
    if (!smsSent) console.error("Failed to send order SMS:", smsResult.message);
  } catch (smsErr) {
    console.error("Failed to send order SMS:", smsErr.message);
  }

  res.status(201).json({
    success: true,
    message: "Order placed successfully",
    data: {
      order: fullOrder,
      payment: {
        accountNumber: virtualAccountNumber,
        bankName: virtualAccountBank,
        accountName: virtualAccountName,
        emailSent: !!customer.email,
        smsSent,
      },
    },
  });
});

const updateOrder = asyncHandler(async (req, res) => {
  const { status, paymentStatus } = req.body;
  const order = await orderRepo.findById(req.params.id);

  if (!order) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }

  const updateData = {};
  if (status !== undefined) updateData.status = status;
  if (paymentStatus !== undefined) updateData.paymentStatus = paymentStatus;

  await orderRepo.update(order.id, updateData);

  if (order.status === "Completed" || order.paymentStatus === "Paid" || status === "Completed" || paymentStatus === "Paid") {
    try {
      await generateTicketForOrder(order.id);
    } catch (ticketErr) {
      console.error("Failed to generate ticket on manual order update:", ticketErr.message);
    }
  }

  const updatedOrder = await orderRepo.findByIdFull(order.id);

  res.json({
    success: true,
    message: "Order updated successfully",
    data: { order: updatedOrder },
  });
});

const cancelOrder = asyncHandler(async (req, res) => {
  const order = await orderRepo.findById(req.params.id);
  if (!order) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }
  if (order.status === "Cancelled") {
    return res.status(400).json({ success: false, message: "Order is already cancelled" });
  }
  if (order.status === "Completed") {
    return res.status(400).json({ success: false, message: "Cannot cancel a completed order" });
  }

  // Reverse PFI stock
  if (order.pfiId) {
    await pfiRepo.releaseStock(order.pfiId, order.quantity);
  }

  // Restore depot capacity
  await depotRepo.incrementProductCapacity(order.depotId, order.productId, order.quantity);

  // If order was paid, refund to balance
  if (order.paymentStatus === "Paid") {
    const customer = await customerRepo.findById(order.customerId);
    await customerRepo.updateBalance(order.customerId, Number(order.totalAmount));

    try {
      await depositRepo.create({
        customerId: order.customerId,
        amount: String(order.totalAmount),
        type: "credit",
        description: `Refund for cancelled Order ${order.orderNumber}`,
        balanceAfter: String(Number(customer.balance || 0) + Number(order.totalAmount)),
      });
    } catch (depErr) {
      console.error("Failed to record cancellation refund:", depErr.message);
    }
  }

  await orderRepo.update(order.id, { status: "Cancelled" });

  const updatedOrder = await orderRepo.findByIdFull(order.id);

  res.json({ success: true, message: "Order cancelled successfully", data: { order: updatedOrder } });
});

const completeOrder = asyncHandler(async (req, res) => {
  const order = await orderRepo.findById(req.params.id);
  if (!order) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }
  if (order.status === "Cancelled") {
    return res.status(400).json({ success: false, message: "Cannot complete a cancelled order" });
  }
  if (order.paymentStatus !== "Paid") {
    return res.status(400).json({ success: false, message: "Cannot complete an unpaid order" });
  }
  if (order.status === "Completed") {
    return res.status(400).json({ success: false, message: "Order is already completed" });
  }

  await orderRepo.update(order.id, { status: "Completed" });

  try {
    await generateTicketForOrder(order.id);
  } catch (ticketErr) {
    console.error("Failed to generate ticket on completion:", ticketErr.message);
  }

  const updatedOrder = await orderRepo.findByIdFull(order.id);

  res.json({ success: true, message: "Order completed successfully", data: { order: updatedOrder } });
});

module.exports = {
  getOrders,
  getOrderById,
  createOrder,
  updateOrder,
  cancelOrder,
  completeOrder,
};
