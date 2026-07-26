require("dotenv").config();
const axios = require("axios");
const { processPaystackPayment } = require("../services/payment.service");

const referenceArg = process.argv[2];

const PAYSTACK_BASE_URL = "https://api.paystack.co";

const syncSingleReference = async (ref) => {
  console.log(`\n--------------------------------------------------`);
  console.log(`Processing Paystack transaction reference: ${ref}...`);
  const result = await processPaystackPayment({ reference: ref.trim() }, "cli_sync");
  if (result.success) {
    if (result.alreadyProcessed) {
      console.log(`ℹ️  Reference ${ref} was ALREADY processed in the database.`);
    } else {
      console.log(`✅  Successfully processed deposit for reference ${ref}!`);
      console.log(`   Customer Type : ${result.customerType}`);
      console.log(`   Amount        : ₦${result.amount}`);
      if (result.customer) console.log(`   Customer Name : ${result.customer.name}`);
      if (result.deliveryCustomer) console.log(`   Delivery Cust : ${result.deliveryCustomer.name}`);
    }
  } else {
    console.error(`❌  Failed to process deposit: ${result.message}`);
  }
  return result;
};

(async () => {
  try {
    if (referenceArg) {
      await syncSingleReference(referenceArg);
    } else {
      console.log("No specific reference provided. Fetching recent transactions from Paystack API...");
      const response = await axios.get(`${PAYSTACK_BASE_URL}/transaction?perPage=20`, {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      });

      const transactions = response.data?.data || [];
      console.log(`Found ${transactions.length} recent transactions on Paystack.`);

      const successfulTxs = transactions.filter((tx) => tx.status === "success");
      console.log(`Found ${successfulTxs.length} successful transactions to inspect.\n`);

      let syncedCount = 0;
      for (const tx of successfulTxs) {
        const res = await syncSingleReference(tx.reference);
        if (res.success && !res.alreadyProcessed) {
          syncedCount++;
        }
      }

      console.log(`\n==================================================`);
      console.log(`Sync completed! ${syncedCount} new deposit(s) recorded.`);
    }
  } catch (err) {
    console.error("❌ Error executing sync:", err.response?.data?.message || err.message);
  }
  process.exit(0);
})();
