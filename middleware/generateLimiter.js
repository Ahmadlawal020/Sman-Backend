const rateLimit = require("express-rate-limit");
const { logEvents } = require("./logger");

const generateLimiter = ({ windowMs, max, message }) => {
  return rateLimit({
    windowMs,
    max,
    message: { success: false, message },
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
