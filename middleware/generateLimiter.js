const rateLimit = require("express-rate-limit");
const { logEvents } = require("./logger");

const generateLimiter = ({ windowMs, max, message }) => {
  return rateLimit({
    windowMs,
    max,
    message: { success: false, message },
    // The limiter is per-process and in-memory, so a suite that logs in more
    // than `max` times trips it and every later assertion fails on a 429 that
    // has nothing to do with what is being tested. Evaluated per request, so a
    // test wanting to exercise the limiter can switch it back on.
    skip: () => process.env.RATE_LIMIT_DISABLED === "true",
    handler: (req, res, next, options) => {
      logEvents(
        `Too Many Requests: ${message}\t${req.method}\t${req.url}\t${req.ip}`,
        "errLog.log"
      );
      res.status(options.statusCode).send(options.message);
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

module.exports = generateLimiter;
