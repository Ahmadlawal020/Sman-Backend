require("dotenv").config();
const https = require("https");

const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

if (!SECRET_KEY) {
  console.error("No PAYSTACK_SECRET_KEY found");
  process.exit(1);
}

const paystackGet = (path) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.paystack.co",
      port: 443,
      path: path,
      method: "GET",
      headers: {
        Authorization: `Bearer ${SECRET_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": "Node-JS",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error("Failed to parse JSON: " + data.substring(0, 100)));
        }
      });
    });

    req.on("error", (e) => reject(e));
    req.setTimeout(25000, () => {
      req.destroy();
      reject(new Error("Request timeout (25s)"));
    });
    req.end();
  });
};

(async () => {
  console.log("=================================================================");
  console.log("          🔍 LIVE PAYSTACK SUBACCOUNT & TRANSFERS AUDIT          ");
  console.log("=================================================================\n");

  // 1. Fetch Subaccounts
  console.log("📌 1. Registered Subaccounts on Paystack:");
  const subRes = await paystackGet("/subaccount");
  const subaccounts = subRes.data || [];
  console.log(`Found ${subaccounts.length} subaccount(s):\n`);

  subaccounts.forEach((sa, i) => {
    console.log(` [${i + 1}] Business Name : ${sa.business_name}`);
    console.log(`     Subaccount Code: ${sa.subaccount_code}`);
    console.log(`     Settlement Bank: ${sa.settlement_bank}`);
    console.log(`     Account Number : ${sa.account_number}`);
    console.log(`     Split Share %  : ${sa.percentage_charge}%\n`);
  });

  // 2. Fetch Balance
  console.log("📌 2. Merchant Main Balance:");
  try {
    const balRes = await paystackGet("/balance");
    if (balRes.data && balRes.data.length > 0) {
      balRes.data.forEach((b) => {
        console.log(`   Currency: ${b.currency} | Balance: ₦${(b.balance / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`);
      });
    }
  } catch (e) {
    console.log("   Could not fetch balance:", e.message);
  }

  // 3. Fetch Transfers (Small batches to prevent timeout)
  console.log("\n📌 3. Paystack Direct Transfers (Small Batch Check):");
  let transfers = [];
  try {
    const trRes = await paystackGet("/transfer?perPage=10");
    transfers = trRes.data || [];
    console.log(`Fetched ${transfers.length} recent transfer record(s).\n`);
  } catch (e) {
    console.log("   Transfer fetch notice:", e.message);
  }

  // 4. Fetch Transactions (Small batches)
  console.log("📌 4. Paystack Transactions (Small Batch Check):");
  let transactions = [];
  try {
    const txRes = await paystackGet("/transaction?perPage=10");
    transactions = txRes.data || [];
    console.log(`Fetched ${transactions.length} recent transaction record(s).\n`);
  } catch (e) {
    console.log("   Transaction fetch notice:", e.message);
  }

  // 5. Fetch per Subaccount Transactions
  console.log("📌 5. Checking transactions per subaccount specifically:");
  for (const sa of subaccounts) {
    try {
      const saTxRes = await paystackGet(`/transaction?subaccount=${sa.subaccount_code}&perPage=10`);
      const saTxs = saTxRes.data || [];
      console.log(`   - ${sa.business_name} (${sa.subaccount_code}): ${saTxs.length} transaction(s) found`);
      if (saTxs.length > 0) {
        saTxs.forEach(t => {
          console.log(`     * Ref: ${t.reference} | Amount: ₦${t.amount/100} | Status: ${t.status}`);
        });
      }
    } catch (e) {
      console.log(`   - ${sa.business_name} (${sa.subaccount_code}): query timeout/error (${e.message})`);
    }
  }

  console.log("\n=================================================================");
  console.log(" ✅ PAYSTACK AUDIT COMPLETE ");
  console.log("=================================================================\n");
})();
