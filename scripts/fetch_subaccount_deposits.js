require("dotenv").config();
const axios = require("axios");

const PAYSTACK_BASE_URL = "https://api.paystack.co";
const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

if (!SECRET_KEY) {
  console.error("❌ Error: PAYSTACK_SECRET_KEY is not defined in environment variables.");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${SECRET_KEY}`,
  "Content-Type": "application/json",
};

const formatCurrency = (amountInKobo) => {
  const naira = (amountInKobo || 0) / 100;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
  }).format(naira);
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const fetchWithRetry = async (url, retries = 3, delay = 1000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, { headers, timeout: 15000 });
      return response.data;
    } catch (err) {
      const status = err.response?.status;
      if (attempt === retries) {
        throw err;
      }
      console.warn(` ⚠️ Attempt ${attempt} failed for ${url} (Status: ${status || err.message}). Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
};

const fetchAllPages = async (endpoint, params = {}) => {
  let page = 1;
  let allData = [];
  const perPage = params.perPage || 20;

  while (true) {
    try {
      const queryParams = new URLSearchParams({ ...params, perPage, page }).toString();
      const url = `${PAYSTACK_BASE_URL}${endpoint}?${queryParams}`;
      const resData = await fetchWithRetry(url);
      const data = resData?.data || [];
      
      if (!data || data.length === 0) break;
      allData = allData.concat(data);
      
      const meta = resData?.meta;
      if (meta && page >= meta.pageCount) break;
      page++;
      await sleep(300); // polite pause between pages
    } catch (err) {
      console.error(` ❌ Failed to fetch page ${page} of ${endpoint}:`, err.response?.data?.message || err.message);
      break;
    }
  }
  return allData;
};

const run = async () => {
  console.log("==================================================================");
  console.log(" 🔍 FETCHING ALL SUBACCOUNT DEPOSITS DIRECTLY FROM PAYSTACK ");
  console.log("==================================================================\n");

  // 1. Fetch Subaccounts
  console.log("⏳ 1/3 Fetching registered subaccounts...");
  let subaccounts = [];
  try {
    const subRes = await fetchWithRetry(`${PAYSTACK_BASE_URL}/subaccount`);
    subaccounts = subRes?.data || [];
  } catch (err) {
    console.error("⚠️ Failed to fetch subaccounts list:", err.response?.data?.message || err.message);
  }
  console.log(`✅ Found ${subaccounts.length} subaccount(s) on Paystack.\n`);

  const subaccountMap = {};
  subaccounts.forEach((sa) => {
    subaccountMap[sa.subaccount_code] = {
      code: sa.subaccount_code,
      name: sa.business_name,
      bank: sa.settlement_bank,
      accountNumber: sa.account_number,
      percentageCharge: sa.percentage_charge,
      transactionTotalKobo: 0,
      transferTotalKobo: 0,
      transactionCount: 0,
      transferCount: 0,
      records: [],
    };
  });

  // 2. Fetch Transactions (per subaccount first + general check)
  console.log("⏳ 2/3 Fetching transactions per subaccount...");
  const subaccountTxRecords = [];

  for (const sa of subaccounts) {
    const code = sa.subaccount_code;
    console.log(` 🔎 Querying split transactions for ${sa.business_name} (${code})...`);
    
    // Fetch transactions explicitly filtered by subaccount
    const txs = await fetchAllPages("/transaction", { subaccount: code, perPage: 20 });
    const successful = txs.filter((t) => t.status === "success");

    successful.forEach((tx) => {
      let subaccountAmountKobo = tx.amount;
      if (tx.fees_split && tx.fees_split.subaccount) {
        subaccountAmountKobo = tx.fees_split.subaccount;
      }

      subaccountMap[code].transactionTotalKobo += subaccountAmountKobo;
      subaccountMap[code].transactionCount += 1;

      const record = {
        type: "Split Transaction",
        reference: tx.reference,
        date: tx.paid_at || tx.created_at,
        totalTxAmount: tx.amount,
        subaccountAmount: subaccountAmountKobo,
        customer: tx.customer?.email || tx.customer?.customer_code || "N/A",
        subaccountCode: code,
        subaccountName: sa.business_name,
      };

      subaccountMap[code].records.push(record);
      subaccountTxRecords.push(record);
    });
  }

  // Also query recent general transactions to catch any split transactions not caught by ?subaccount filter
  console.log(" 🔎 Inspecting general transactions for any additional split payments...");
  const generalTxs = await fetchAllPages("/transaction", { perPage: 20 });
  const generalSuccessful = generalTxs.filter((t) => t.status === "success");

  generalSuccessful.forEach((tx) => {
    const sa = tx.subaccount;
    const saCode = typeof sa === "string" ? sa : sa?.subaccount_code;
    if (saCode && subaccountMap[saCode]) {
      // Check if already added
      const exists = subaccountMap[saCode].records.some((r) => r.reference === tx.reference);
      if (!exists) {
        let subaccountAmountKobo = tx.amount;
        if (tx.fees_split && tx.fees_split.subaccount) {
          subaccountAmountKobo = tx.fees_split.subaccount;
        }

        subaccountMap[saCode].transactionTotalKobo += subaccountAmountKobo;
        subaccountMap[saCode].transactionCount += 1;

        const record = {
          type: "Split Transaction",
          reference: tx.reference,
          date: tx.paid_at || tx.created_at,
          totalTxAmount: tx.amount,
          subaccountAmount: subaccountAmountKobo,
          customer: tx.customer?.email || tx.customer?.customer_code || "N/A",
          subaccountCode: saCode,
          subaccountName: subaccountMap[saCode].name,
        };

        subaccountMap[saCode].records.push(record);
        subaccountTxRecords.push(record);
      }
    }
  });

  // 3. Fetch Transfers
  console.log("\n⏳ 3/3 Fetching all transfers made to subaccount bank accounts...");
  const transfers = await fetchAllPages("/transfer", { perPage: 20 });
  const successfulTransfers = transfers.filter((t) => ["success", "processed"].includes(t.status));
  console.log(`✅ Fetched ${transfers.length} total transfer(s), ${successfulTransfers.length} successful/processed.\n`);

  const transferRecords = [];

  successfulTransfers.forEach((tr) => {
    const recipient = tr.recipient || {};
    const recipientName = recipient.name || recipient.details?.account_name || "Unknown Recipient";
    const recipientAccount = recipient.details?.account_number || "N/A";
    const recipientBank = recipient.details?.bank_name || "N/A";

    let matchedSubaccountCode = null;
    for (const code in subaccountMap) {
      if (subaccountMap[code].accountNumber === recipientAccount) {
        matchedSubaccountCode = code;
        break;
      }
    }

    if (matchedSubaccountCode) {
      subaccountMap[matchedSubaccountCode].transferTotalKobo += tr.amount;
      subaccountMap[matchedSubaccountCode].transferCount += 1;
    }

    const record = {
      type: "Transfer",
      reference: tr.reference,
      transferCode: tr.transfer_code,
      date: tr.created_at,
      amount: tr.amount,
      reason: tr.reason || "N/A",
      recipientName,
      recipientAccount,
      recipientBank,
      matchedSubaccountCode: matchedSubaccountCode || "N/A",
    };
    transferRecords.push(record);
  });

  // FINAL SUMMARY REPORT
  console.log("==================================================================");
  console.log("                       📊 SUMMARY REPORT                          ");
  console.log("==================================================================");

  let grandTotalSubaccountTxKobo = 0;
  let grandTotalTransferKobo = 0;

  Object.values(subaccountMap).forEach((sa) => {
    grandTotalSubaccountTxKobo += sa.transactionTotalKobo;
    grandTotalTransferKobo += sa.transferTotalKobo;
  });

  const grandTotalTransfersAllRecipientsKobo = transferRecords.reduce((acc, r) => acc + r.amount, 0);

  console.log(`Subaccounts Registered         : ${subaccounts.length}`);
  console.log(`Total Split Tx Subaccount Share: ${formatCurrency(grandTotalSubaccountTxKobo)} (${subaccountTxRecords.length} transactions)`);
  console.log(`Subaccount Transfers           : ${formatCurrency(grandTotalTransferKobo)} (${transferRecords.filter(t => t.matchedSubaccountCode !== 'N/A').length} transfers)`);
  console.log(`All Merchant Direct Transfers  : ${formatCurrency(grandTotalTransfersAllRecipientsKobo)} (${transferRecords.length} transfers)`);
  console.log("------------------------------------------------------------------");
  console.log(`TOTAL MONEY DEPOSITED/TRANSFERRED TO SUBACCOUNTS: ${formatCurrency(grandTotalSubaccountTxKobo + grandTotalTransferKobo)}`);
  console.log("==================================================================\n");

  console.log("🏢 SUBACCOUNT DETAILED BREAKDOWN:");
  console.log("------------------------------------------------------------------");
  if (Object.keys(subaccountMap).length === 0) {
    console.log("No subaccounts found.");
  } else {
    Object.values(subaccountMap).forEach((sa, idx) => {
      const combinedTotalKobo = sa.transactionTotalKobo + sa.transferTotalKobo;
      console.log(`\n[${idx + 1}] ${sa.name} (${sa.code})`);
      console.log(`    Bank Account     : ${sa.bank} - ${sa.accountNumber}`);
      console.log(`    Split Share %    : ${sa.percentageCharge}%`);
      console.log(`    Split Tx Deposits: ${formatCurrency(sa.transactionTotalKobo)} (${sa.transactionCount} txs)`);
      console.log(`    Direct Transfers : ${formatCurrency(sa.transferTotalKobo)} (${sa.transferCount} transfers)`);
      console.log(`    TOTAL RECEIVED   : ${formatCurrency(combinedTotalKobo)}`);
    });
  }

  if (subaccountTxRecords.length > 0) {
    console.log("\n------------------------------------------------------------------");
    console.log("📜 SUBACCOUNT SPLIT TRANSACTIONS LIST:");
    console.log("------------------------------------------------------------------");
    subaccountTxRecords.forEach((rec, idx) => {
      console.log(`${idx + 1}. [${new Date(rec.date).toISOString().split("T")[0]}] Ref: ${rec.reference}`);
      console.log(`   Subaccount: ${rec.subaccountName} (${rec.subaccountCode})`);
      console.log(`   Total Tx  : ${formatCurrency(rec.totalTxAmount)} | Subaccount Share: ${formatCurrency(rec.subaccountAmount)}`);
    });
  } else {
    console.log("\nℹ️ No direct split transactions found attached to these subaccounts.");
  }

  if (transferRecords.length > 0) {
    console.log("\n------------------------------------------------------------------");
    console.log("📜 DIRECT TRANSFERS LIST:");
    console.log("------------------------------------------------------------------");
    transferRecords.forEach((rec, idx) => {
      console.log(`${idx + 1}. [${new Date(rec.date).toISOString().split("T")[0]}] Ref: ${rec.reference}`);
      console.log(`   Recipient : ${rec.recipientName} (${rec.recipientBank} - ${rec.recipientAccount})`);
      console.log(`   Amount    : ${formatCurrency(rec.amount)} | Reason: ${rec.reason}`);
    });
  } else {
    console.log("\nℹ️ No direct transfers found on Paystack for this merchant account.");
  }

  console.log("\n==================================================================");
  console.log(" ✅ COMPLETED SUCCESSFULLY ");
  console.log("==================================================================\n");
};

run().catch((err) => {
  console.error("Fatal error running script:", err);
  process.exit(1);
});
