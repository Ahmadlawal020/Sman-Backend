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

// Webhook must be mounted BEFORE global express.json() so its raw-body
// parser runs and the HMAC verify callback actually fires.
app.use("/api/webhooks", require("./routes/webhook.route"));

app.use(express.json());
// Express 5 has res.cookie but no req.cookies — it was removed in 6244c4f.
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
app.use("/api/filing-stations", require("./routes/administration/filingStation.route"));
app.use("/api/products", require("./routes/administration/product.route"));
app.use("/api/pfis", require("./routes/administration/pfi.route"));
app.use("/api/customers", require("./routes/administration/customer.route"));
app.use("/api/delivery-customers", require("./routes/administration/deliveryCustomer.route"));
app.use("/api/delivery-inventory", require("./routes/administration/deliveryInventory.route"));
app.use("/api/delivery-sales", require("./routes/administration/deliverySale.route"));
app.use("/api/orders", require("./routes/administration/order.route"));
app.use("/api/tickets", require("./routes/administration/ticket.route"));
app.use("/api/deposits", require("./routes/administration/deposit.route"));

// ERP modules
app.use("/api/fleet", require("./routes/administration/fleet.route"));
app.use("/api/daily-reports", require("./routes/administration/dailyReport.route"));
app.use("/api/incidents", require("./routes/administration/incident.route"));
app.use("/api/offline-sales", require("./routes/administration/offlineSale.route"));
app.use("/api/reports", require("./routes/administration/reporting.route"));

// Event consumers: audit writes every business event; notifications react to
// the ones customers and staff should hear about. Registered once, here,
// so requiring app.js in tests wires the same pipeline as production.
require("./services/audit.service").registerAuditListener();
require("./services/notification.service").registerNotificationListeners();

// Customer-facing portal. Note it sits one character from the staff-only
// /api/customers above — a readability hazard, not a routing bug: Express
// matches mounts at segment boundaries, order-independently.
app.use("/api/customer/auth", require("./routes/portal/auth.route"));

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
