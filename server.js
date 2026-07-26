const app = require("./app");
const { testConnection } = require("./config/db");
const { logEvents } = require("./middleware/logger");
const PORT = process.env.PORT || 5002;

// REFRESH_TOKEN_SECRET is deliberately absent: refresh tokens are opaque
// random strings looked up by hash, so there is nothing to sign.
const REQUIRED_ENV_VARS = ["DATABASE_URL", "PAYSTACK_SECRET_KEY"];

const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Fatal: Missing required environment variables: ${missing.join(", ")}`);
  console.error("Please configure these in your .env file before starting the server.");
  process.exit(1);
}

// Resolving the realm secrets asserts they exist and differ. Done at boot so a
// misconfiguration fails immediately rather than at the first login attempt.
try {
  require("./config/auth").secrets();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// The OTP development bypass must never be reachable in production. Checked
// against a live Paystack key too, because NODE_ENV is the easier of the two
// to get wrong.
if (process.env.OTP_DEV_MODE === "true") {
  const looksLive =
    process.env.NODE_ENV === "production" ||
    (process.env.PAYSTACK_SECRET_KEY || "").startsWith("sk_live_");
  if (looksLive) {
    console.error("Fatal: OTP_DEV_MODE must not be enabled in a production environment.");
    process.exit(1);
  }
  console.warn("[otp] OTP_DEV_MODE is ON — codes are fixed and no SMS is sent.");
}

// Turnstile is optional while the frontend catches up, but never in production.
if (process.env.NODE_ENV === "production" && !process.env.TURNSTILE_SECRET_KEY) {
  console.error("Fatal: TURNSTILE_SECRET_KEY must be set in production.");
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
