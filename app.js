require("dotenv").config();
const express = require("express");
const app = express();
app.set("trust proxy", 1);
const path = require("path");
const { logger } = require("./middleware/logger");
const errorHandler = require("./middleware/errorHandler");
const cors = require("cors");
const corsOptions = require("./config/corsOptions");
const helmet = require("helmet");

// Middleware
app.use(helmet());
app.use(logger);
app.use(cors(corsOptions));

// Webhooks must be mounted BEFORE global express.json() so their raw-body
// parsers run and the HMAC verify callbacks actually fire.
app.use("/api/webhooks", require("./routes/webhook.route"));
app.use("/api/whatsapp/webhook", require("./routes/whatsappWebhook.route"));

app.use(express.json());
// `res.cookie` is built in, but `req.cookies` is not and never was — parsing
// the Cookie header has always been cookie-parser's job, in Express 4 as well.
// Required here because the refresh token travels in an httpOnly cookie.
app.use(require("cookie-parser")());

// Express 5 leaves req.body undefined when no body was parsed (v4 defaulted
// to {}). Controllers destructure req.body directly, so restore the v4 shape.
app.use((req, _res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

// Routes
app.use("/api/auth", require("./routes/administration/auth.route"));
app.use("/api/admin", require("./routes/administration/staff.route"));
app.use("/api/dashboard", require("./routes/administration/dashboard.route"));
app.use("/api/trucks", require("./routes/administration/truck.route"));
app.use("/api/drivers", require("./routes/administration/driver.route"));
app.use("/api/depots", require("./routes/administration/depot.route"));
app.use("/api/lpg-stations", require("./routes/administration/lpgStation.route"));
app.use("/api/filing-stations", require("./routes/administration/filingStation.route"));
app.use("/api/products", require("./routes/administration/product.route"));
app.use("/api/pfis", require("./routes/administration/pfi.route"));
app.use("/api/expenses", require("./routes/administration/expense.route"));
app.use("/api/customers", require("./routes/administration/customer.route"));
app.use("/api/delivery-customers", require("./routes/administration/deliveryCustomer.route"));
app.use("/api/delivery-inventory", require("./routes/administration/deliveryInventory.route"));
app.use("/api/delivery-sales", require("./routes/administration/deliverySale.route"));
app.use("/api/orders", require("./routes/administration/order.route"));
app.use("/api/tickets", require("./routes/administration/ticket.route"));
app.use("/api/deposits", require("./routes/administration/deposit.route"));
app.use("/api/bank-accounts", require("./routes/administration/bankAccount.route"));
app.use("/api/bank-statements", require("./routes/administration/bankStatement.route"));
app.use("/api/settlements", require("./routes/administration/settlement.route"));
app.use("/api/order-expiry", require("./routes/administration/orderExpiry.route"));

// ERP modules
app.use("/api/fleet", require("./routes/administration/fleet.route"));
app.use("/api/daily-reports", require("./routes/administration/dailyReport.route"));
app.use("/api/incidents", require("./routes/administration/incident.route"));
app.use("/api/offline-sales", require("./routes/administration/offlineSale.route"));
app.use("/api/reports", require("./routes/administration/reporting.route"));
app.use("/api/commissions", require("./routes/administration/commission.route"));
app.use("/api/customer-licenses", require("./routes/administration/customerLicense.route"));
app.use("/api/uploads", require("./routes/administration/upload.route"));

// Dangote orders
app.use("/api", require("./routes/administration/dangoteOrder.route"));

// LPG cooking gas orders
app.use("/api", require("./routes/administration/lpgOrder.route"));

// Event consumers: audit writes every business event; notifications react to
// the ones customers and staff should hear about. Registered once, here,
// so requiring app.js in tests wires the same pipeline as production.
require("./services/audit.service").registerAuditListener();
require("./services/notification.service").registerNotificationListeners();

// Customer-facing portal. Note it sits one character from the staff-only
// /api/customers above — a readability hazard, not a routing bug: Express
// matches mounts at segment boundaries, order-independently.
app.use("/api/customer/auth", require("./routes/portal/auth.route"));
// Additional sign-in methods (password, PIN, Google, Apple, passkeys) beyond
// the default phone+OTP flow above. Same path prefix, same cookie scope.
app.use("/api/customer/auth", require("./routes/portal/identity.route"));
app.use("/api/customer/orders", require("./routes/portal/order.route"));
app.use("/api/customer/profile", require("./routes/portal/profile.route"));
app.use("/api/customer/dashboard", require("./routes/portal/dashboard.route"));
// Public: live depot prices for the marketing site and the portal's order
// form — no account needed to see what's on sale, exactly as on WhatsApp.
app.use("/api/catalog", require("./routes/portal/catalog.route"));
// Public: open LPG (cooking gas) stations with price + cylinder stock.
app.use("/api/lpg-catalog", require("./routes/portal/lpgCatalog.route"));
// Customer-facing LPG cooking-gas order requests (create/list/view own).
app.use("/api/customer/lpg-orders", require("./routes/portal/lpgOrder.route"));
// Public: active Dangote bulk products for the quote wizard's picker.
app.use("/api/dangote-catalog", require("./routes/portal/dangoteCatalog.route"));
// Customer-facing Dangote bulk quote requests (create/list/view own).
app.use("/api/customer/dangote-orders", require("./routes/portal/dangoteOrder.route"));
// Customer-facing license register (list/add own, upload signature).
app.use("/api/customer/licenses", require("./routes/portal/license.route"));
// Public: sanitised order tracking by reference — movement only, no price or
// buyer identity. The order number is the shared secret.
app.use("/api/tracking", require("./routes/portal/tracking.route"));

// Public: device-aware store redirect behind the "Download mobile app"
// button in WhatsApp — the one URL the bot sends for every device.
app.use("/app", require("./routes/appRedirect.route"));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "Dashboard server is running" });
});

// 404 Handler
// Express 5 (path-to-regexp v8) dropped the bare "*" wildcard. "/{*splat}" is
// the braced form, which — unlike "/*splat" — also matches the root path "/".
app.all("/{*splat}", (req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Error handling middleware
app.use(errorHandler);

module.exports = app;
