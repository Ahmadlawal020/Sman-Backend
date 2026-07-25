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

testConnection()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Dashboard server running on port ${PORT}`);
    });
  })
  .catch(() => {
    console.error("Failed to connect to database. Exiting.");
    process.exit(1);
  });
