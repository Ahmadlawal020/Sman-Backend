const defaultAllowedOrigins = require("./allowedOrigins");

const normalizeOrigin = (origin) => origin.trim().replace(/\/+$/, "");

const getOriginsList = () => {
  const envOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

  const defaultOrigins = defaultAllowedOrigins.map((origin) => normalizeOrigin(origin));
  return new Set([...defaultOrigins, ...envOrigins]);
};

const isOriginAllowed = (origin) => {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  const allowedOriginsSet = getOriginsList();

  if (allowedOriginsSet.has(normalized)) {
    return true;
  }

  // In non-production environments (development / test), permit any localhost or 127.0.0.1 origin
  if (process.env.NODE_ENV !== "production") {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)) {
      return true;
    }
  }

  return false;
};

const corsOptions = {
  origin: (origin, callback) => {
    // 1. Allow requests with no Origin header (e.g. Postman, cURL, mobile apps, server-to-server)
    // unless explicitly disabled via CORS_ALLOW_NO_ORIGIN=false
    if (!origin) {
      if (process.env.CORS_ALLOW_NO_ORIGIN === "false") {
        return callback(Object.assign(new Error("Not allowed by CORS"), { status: 403 }));
      }
      return callback(null, true);
    }

    // 2. Validate Origin against allowed list / dev regex
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }

    return callback(Object.assign(new Error("Not allowed by CORS"), { status: 403 }));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "X-CSRF-Token",
    "Idempotency-Key",
    "X-Api-Key",
  ],
  exposedHeaders: [
    "Content-Range",
    "X-Content-Range",
    "Set-Cookie",
    "X-Total-Count",
    "X-Request-ID",
  ],
  maxAge: 86400,
  optionsSuccessStatus: 200,
};

module.exports = corsOptions;

