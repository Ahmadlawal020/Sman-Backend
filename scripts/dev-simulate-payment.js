#!/usr/bin/env node
/**
 * DEV ONLY — simulate a customer's bank transfer landing.
 *
 *   node scripts/dev-simulate-payment.js <phone> [amountNaira]
 *
 * Test-mode Paystack cannot receive a real transfer into a test DVA, and the
 * webhook path verifies references against Paystack's API — so a faked
 * webhook cannot pass. What CAN be exercised is everything downstream of
 * money arriving, which is exactly what the webhook does after verification:
 * credit the wallet ledger, then settle unpaid orders oldest-first. That
 * drives Pending→Paid through the state machine, writes the audit row,
 * generates the ticket, and enqueues the WhatsApp "payment received" push —
 * the full production path, minus only Paystack's own verification step.
 *
 * Amount defaults to the customer's total unpaid order value.
 */
require("dotenv").config();

const { toE164 } = require("../utils/phone");
const { customerRepo, orderRepo } = require("../repositories");
const walletService = require("../services/wallet.service");
const { processUnpaidOrdersForCustomer } = require("../services/payment.service");

const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

(async () => {
  if (process.env.NODE_ENV === "production") die("refusing to run in production");
  if ((process.env.PAYSTACK_SECRET_KEY || "").startsWith("sk_live")) {
    die("refusing to run against a LIVE Paystack key");
  }

  const [, , phoneArg, amountArg] = process.argv;
  if (!phoneArg) die("usage: node scripts/dev-simulate-payment.js <phone> [amountNaira]");

  const phone = toE164(phoneArg) || phoneArg;
  const customer = await customerRepo.findByPhone(phone);
  if (!customer) die(`no customer with phone ${phone}`);

  const unpaid = (await orderRepo.findUnpaidByCustomer(customer.id)) || [];
  const owed = unpaid.reduce((s, o) => s + Number(o.totalAmount || 0), 0);
  const amount = amountArg ? Number(amountArg) : owed;
  if (!amount || amount <= 0) die(`nothing to pay: no amount given and no unpaid orders (owed: ₦${owed})`);

  console.log(`Customer #${customer.id} ${customer.name} — unpaid orders: ${unpaid.length} (₦${owed.toLocaleString()})`);
  console.log(`Crediting wallet with ₦${amount.toLocaleString()} (simulated transfer)…`);

  const credit = await walletService.credit({
    customerId: customer.id,
    amount,
    description: "Simulated bank transfer (dev)",
    reference: `DEV-SIM-${Date.now()}`,
  });
  if (!credit.success) die(`wallet credit failed: ${credit.message}`);

  const settled = await processUnpaidOrdersForCustomer(customer.id);
  for (const order of settled) {
    console.log(`✓ settled ${order.orderNumber} — Pending→Paid, ticket generated, WhatsApp push enqueued`);
  }
  if (settled.length === 0) {
    console.log("No orders settled (balance may not cover the oldest unpaid order).");
  }

  const after = await customerRepo.findById(customer.id);
  console.log(`Wallet balance now: ₦${Number(after.balance).toLocaleString()}`);
  process.exit(0);
})().catch((err) => die(err.message));
