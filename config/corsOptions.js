const defaultAllowedOrigins = require("./allowedOrigins");

const envOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...envOrigins])];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, mobile apps) only when
    // explicitly opted in. Reject null origin (sandboxed iframes, data: URIs)
    // to prevent CORS bypass.
    if (origin && allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    if (!origin && process.env.CORS_ALLOW_NO_ORIGIN === "true") {
      return callback(null, true);
    }
    return callback(Object.assign(new Error("Not allowed by CORS"), { status: 403 }));
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

module.exports = corsOptions;
