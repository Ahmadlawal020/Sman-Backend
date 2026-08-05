require("dotenv").config();
const axios = require("axios");

const PAYSTACK_BASE_URL = "https://api.paystack.co";
const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

const headers = {
  Authorization: `Bearer ${SECRET_KEY}`,
  "Content-Type": "application/json",
};

(async () => {
  try {
    console.log("Checking Paystack Account Overview...");
    
    // 1. Check Balance
    try {
      const bal = await axios.get(`${PAYSTACK_BASE_URL}/balance`, { headers });
      console.log("💰 Paystack Merchant Balance:", bal.data?.data);
    } catch (e) {
      console.log("Balance fetch error:", e.response?.data?.message || e.message);
    }

    // 2. Check Subaccounts
    try {
      const subs = await axios.get(`${PAYSTACK_BASE_URL}/subaccount`, { headers });
      console.log(`🏢 Subaccounts Count: ${subs.data?.data?.length}`);
      console.log(JSON.stringify(subs.data?.data, null, 2));
    } catch (e) {
      console.log("Subaccount fetch error:", e.response?.data?.message || e.message);
    }

    // 3. Check Dedicated Virtual Accounts
    try {
      const dvas = await axios.get(`${PAYSTACK_BASE_URL}/dedicated_account`, { headers });
      console.log(`💳 Dedicated Virtual Accounts Count: ${dvas.data?.data?.length}`);
      if (dvas.data?.data?.length > 0) {
        console.log(JSON.stringify(dvas.data?.data.slice(0, 5), null, 2));
      }
    } catch (e) {
      console.log("DVA fetch error:", e.response?.data?.message || e.message);
    }

    // 4. Check Transfers
    try {
      const trs = await axios.get(`${PAYSTACK_BASE_URL}/transfer?perPage=10`, { headers });
      console.log(`💸 Total Transfers found on Paystack: ${trs.data?.data?.length}`);
      if (trs.data?.data?.length > 0) {
        console.log("Sample Transfers:", JSON.stringify(trs.data?.data.slice(0, 3), null, 2));
      }
    } catch (e) {
      console.log("Transfer fetch error:", e.response?.data?.message || e.message);
    }

  } catch (err) {
    console.error("Error:", err);
  }
})();
