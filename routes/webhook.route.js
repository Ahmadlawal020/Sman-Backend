const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { db } = require("../config/db");
const {
  customerRepo,
  deliveryCustomerRepo,
  deliverySaleRepo,
  depositRepo,
  orderRepo,
  webhookEventRepo,
  ticketRepo,
} = require("../repositories");
const { verifyTransaction } = require("../services/payment.service");
const { generateTicketForOrder } = require("../services/ticket.service");

// POST /api/webhooks/paystack
router.post(
  "/paystack",
  express.raw({ type: "application/json", verify: verifyPaystackSignature }),
  async (req, res) => {
    let event;
    try {
      event = JSON.parse(req.body);
    } catch {
      return res.sendStatus(400);
    }

    if (event.event !== "dedicated_account.payment") {
      return res.sendStatus(200);
    }

    const data = event.data;
    const accountNumber =
      data?.dedicated_account?.account_number ||
      data?.authorization?.receiver_bank_account_number ||
      "";
    const reference = data?.reference || "";

    if (!accountNumber || !reference) {
      return res.sendStatus(200);
    }

    try {
      // Idempotency: skip if this reference was already processed
      const existingDeposit = await depositRepo.findByReference(reference);
      const existingDeliverySale = await deliverySaleRepo.findByPaystackReference(reference);
      if (existingDeposit || existingDeliverySale) {
        console.log(`Webhook duplicate skipped – reference ${reference} already recorded.`);
        return res.sendStatus(200);
      }

      // Verify the transaction with Paystack
      const verification = await verifyTransaction(reference);
      if (!verification.success || verification.data?.status !== "success") {
        console.error("Paystack transaction verification failed:", reference);
        return res.sendStatus(200);
      }

      const vData = verification.data;
      const amount = vData.amount / 100;

      if (amount <= 0) {
        console.error("Verified amount is zero or negative:", reference);
        return res.sendStatus(200);
      }

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
          data?.authorization?.sender_bank ||
          vData.authorization?.sender_bank ||
          vData.authorization?.bank ||
          null,
        senderAccountNumber:
          data?.authorization?.sender_bank_account_number ||
          vData.authorization?.sender_bank_account_number ||
          vData.authorization?.last4 ||
          null,
        senderName:
          data?.authorization?.sender_name ||
          vData.authorization?.sender_name ||
          vData.authorization?.account_name ||
          null,
        senderCountry: data?.authorization?.sender_country || null,
        senderNarration: data?.authorization?.narration || null,
        receiverBankName: data?.dedicated_account?.bank?.name || null,
        receiverAccountNumber:
          data?.dedicated_account?.account_number || accountNumber,
        receiverAccountName:
          data?.dedicated_account?.account_name || null,
        authorizationCode: vData.authorization?.authorization_code || null,
        bin: vData.authorization?.bin || null,
        last4: vData.authorization?.last4 || null,
        cardType: vData.authorization?.card_type || null,
        bank: vData.authorization?.bank || null,
        ipAddress: vData.ip_address || null,
        metadata: vData.metadata || null,
        paystackCustomerCode: vData.customer?.customer_code || null,
        paystackCustomerEmail: vData.customer?.email || null,
        rawEvent: event.event,
      };

      // Find the customer by virtual account number
      const customer = await customerRepo.findByVirtualAccount(accountNumber);

      if (customer) {
        // Regular Customer Flow
        await depositRepo.create({
          customerId: customer.id,
          amount: String(amount),
          type: "credit",
          description: "Payment received via bank transfer",
          reference: reference,
          balanceAfter: String(Number(customer.balance || 0) + amount),
          paystackDetails: paystackDetails,
        });

        // Update balance atomically
        const previousDeposit = Number(customer.deposit || 0);
        await customerRepo.updateDeposit(customer.id, amount, previousDeposit);

        // Apply to unpaid orders oldest-first
        const { orders: unpaidOrders } = await orderRepo.findUnpaidByCustomer(customer.id);

        let remaining = amount;
        for (const order of unpaidOrders) {
          if (remaining <= 0) break;
          if (remaining >= Number(order.totalAmount)) {
            await orderRepo.update(order.id, { paymentStatus: "Paid" });
            remaining -= Number(order.totalAmount);

            console.log(`Order ${order.orderNumber} marked as Paid via webhook.`);

            try {
              await generateTicketForOrder(order.id);
              console.log(`Ticket generated for Order ${order.orderNumber}`);
            } catch (tktErr) {
              console.error("Failed to generate ticket for Paid order:", tktErr.message);
            }
          }
        }

        const senderLabel = paystackDetails.senderName || "Bank Transfer";
        console.log(
          `Deposit of ${amount} recorded for customer ${customer.name} via ${senderLabel}. Reference: ${reference}`
        );
      } else {
        // Delivery Customer Flow
        const deliveryCustomer = await deliveryCustomerRepo.findByVirtualAccount(accountNumber);

        if (deliveryCustomer) {
          const pendingSale = await deliverySaleRepo.findPendingByCustomer(deliveryCustomer.id);

          if (pendingSale) {
            const previousPayment = Number(pendingSale.paymentAmount || 0);
            const newPaymentAmount = previousPayment + amount;
            const newBalance = Number(pendingSale.salesValue || 0) - newPaymentAmount;

            await deliverySaleRepo.update(pendingSale.id, {
              paymentAmount: String(newPaymentAmount),
              balance: String(newBalance),
              payerName: paystackDetails.senderName || pendingSale.payerName,
              bank: `Paystack DVA (${paystackDetails.receiverBankName})`,
              dateOfPayment: paystackDetails.paidAt
                ? new Date(paystackDetails.paidAt).toISOString().split("T")[0]
                : new Date().toISOString().split("T")[0],
              depositStatus: newBalance <= 0 ? "paid" : "partial",
              paymentMethod: "paystack_dva",
              paystackReference: reference,
              paystackDetails: paystackDetails,
            });

            console.log(
              `Delivery sale ${pendingSale.id} updated with ₦${amount} payment for ${deliveryCustomer.name}. Reference: ${reference}`
            );
          } else {
            await deliverySaleRepo.create({
              customerId: deliveryCustomer.id,
              customerName: deliveryCustomer.name,
              paymentAmount: String(amount),
              salesValue: "0",
              balance: "0",
              payerName: paystackDetails.senderName || "",
              bank: `Paystack DVA (${paystackDetails.receiverBankName})`,
              dateOfPayment: paystackDetails.paidAt
                ? new Date(paystackDetails.paidAt).toISOString().split("T")[0]
                : new Date().toISOString().split("T")[0],
              depositStatus: "paid",
              paymentMethod: "paystack_dva",
              paystackReference: reference,
              paystackDetails: paystackDetails,
              enteredBy: "Paystack Webhook",
              remarks: `Auto-recorded from DVA payment. Sender: ${paystackDetails.senderName || "Unknown"} (${paystackDetails.receiverBankName || ""})`,
            });

            console.log(
              `New delivery sale created for ${deliveryCustomer.name} — ₦${amount} via DVA. Reference: ${reference}`
            );
          }

          await deliveryCustomerRepo.update(deliveryCustomer.id, {
            lastTransactionDate: new Date(),
          });
        } else {
          console.error(
            "Webhook: No customer or delivery customer found for virtual account:",
            accountNumber
          );
          await webhookEventRepo.create({
            event: event.event,
            payload: event,
            status: "failed",
            error: `No customer for account ${accountNumber}`,
          });
          return res.sendStatus(200);
        }
      }

      // Mark event processed
      await webhookEventRepo.create({
        event: event.event,
        payload: event,
        status: "processed",
        processedAt: new Date(),
      });
    } catch (err) {
      console.error("Webhook processing error:", err.message);
      try {
        await webhookEventRepo.create({
          event: event.event,
          payload: event,
          status: "failed",
          error: err.message,
        });
      } catch (logErr) {
        console.error("Failed to persist webhook event:", logErr.message);
      }
    }

    res.sendStatus(200);
  }
);

function verifyPaystackSignature(req, res, buf) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    console.error("PAYSTACK_SECRET_KEY not set – rejecting webhook");
    throw new Error("Webhook signing key not configured");
  }

  const hash = crypto
    .createHmac("sha512", secret)
    .update(buf)
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    throw new Error("Invalid Paystack signature");
  }
}

module.exports = router;
