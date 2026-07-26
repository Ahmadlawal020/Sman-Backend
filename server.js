const app = require("./app");
const { testConnection } = require("./config/db");
const { logEvents } = require("./middleware/logger");
const PORT = process.env.PORT || 5002;

const REQUIRED_ENV_VARS = [
  "DATABASE_URL",
  "ACCESS_TOKEN_SECRET",
  "REFRESH_TOKEN_SECRET",
  "PAYSTACK_SECRET_KEY",
];

const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Fatal: Missing required environment variables: ${missing.join(", ")}`);
  console.error("Please configure these in your .env file before starting the server.");
  process.exit(1);
}

const { processAllUnpaidOrders } = require("./services/payment.service");

testConnection()
  .then(async () => {
    app.listen(PORT, async () => {
      console.log(`Dashboard server running on port ${PORT}`);
      try {
        const count = await processAllUnpaidOrders();
        if (count > 0) {
          console.log(`Auto-processed ${count} unpaid order(s) using available customer balance.`);
        }
      } catch (err) {
        console.error("Error running startup auto-order fulfillment:", err.message);
      }
    });
  })
  .catch(() => {
    console.error("Failed to connect to database. Exiting.");
    process.exit(1);
  });
