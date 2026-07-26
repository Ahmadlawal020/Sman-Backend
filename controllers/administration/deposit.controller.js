const asyncHandler = require("express-async-handler");
const { depositRepo, customerRepo } = require("../../repositories");
const { processPaystackPayment, processUnpaidOrdersForCustomer } = require("../../services/payment.service");

const getDeposits = asyncHandler(async (req, res) => {
  const { customer, page = 1, limit = 50 } = req.query;

  const result = await depositRepo.findAll({ customer, page, limit });

  res.json({ success: true, data: result });
});

const getDepositById = asyncHandler(async (req, res) => {
  const deposit = await depositRepo.findByIdFull(req.params.id);

  if (!deposit) {
    return res.status(404).json({ success: false, message: "Deposit not found" });
  }

  res.json({ success: true, data: { deposit } });
});

const createDeposit = asyncHandler(async (req, res) => {
  const { customer: customerId, amount, type, description, reference } = req.body;

  if (!customerId || !amount || !type) {
    return res.status(400).json({
      success: false,
      message: "Customer, amount, and type are required",
    });
  }

  if (type !== "credit") {
    return res.status(400).json({
      success: false,
      message: "Deposit only handles money coming in (type must be 'credit')",
    });
  }

  const customer = await customerRepo.findById(customerId);
  if (!customer) {
    return res.status(404).json({ success: false, message: "Customer not found" });
  }

  const previousBalance = Number(customer.balance || 0);
  const newBalance = previousBalance + Number(amount);

  await customerRepo.update(customerId, {
    balance: String(newBalance),
    previousDeposit: String(Number(customer.deposit || 0)),
    deposit: String(Number(customer.deposit || 0) + Number(amount)),
  });

  const deposit = await depositRepo.create({
    customerId,
    amount: String(Number(amount)),
    type,
    description: description || "",
    reference: reference || "",
    recordedBy: req.user?.id || null,
    balanceAfter: String(newBalance),
  });

  const fullDeposit = await depositRepo.findByIdFull(deposit.id);

  // Automatically process any unpaid orders for customer using new balance
  await processUnpaidOrdersForCustomer(customerId);

  res.status(201).json({
    success: true,
    message: "Deposit recorded successfully",
    data: { deposit: fullDeposit },
  });
});

const syncPaystackDeposit = asyncHandler(async (req, res) => {
  const { reference } = req.body;

  if (!reference || typeof reference !== "string" || !reference.trim()) {
    return res.status(400).json({
      success: false,
      message: "Paystack transaction reference is required",
    });
  }

  const result = await processPaystackPayment({ reference: reference.trim() }, "manual_sync");

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message,
    });
  }

  res.status(200).json({
    success: true,
    message: result.alreadyProcessed
      ? result.message
      : `Deposit successfully processed and credited for reference ${reference.trim()}`,
    data: result,
  });
});

module.exports = { getDeposits, getDepositById, createDeposit, syncPaystackDeposit };
