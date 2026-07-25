const defaultAllowedOrigins = require("./allowedOrigins");

const envOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...envOrigins])];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(Object.assign(new Error("Not allowed by CORS"), { status: 403 }));
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

module.exports = corsOptions;
