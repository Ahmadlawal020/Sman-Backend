const { logEvents } = require("./logger");

const errorHandler = (err, req, res, next) => {
  logEvents(
    `${err.name}: ${err.message}\t${req.method}\t${req.url}\t${req.headers.origin}`,
    "errLog.log"
  );
  console.log(err.stack);

  let status = res.statusCode;
  if (status === 200) status = 500;
  if (err.name === "ValidationError" || err.name === "CastError") status = 400;
  if (err.code === 11000) status = 409;

  const isProduction = process.env.NODE_ENV === "production";
  const message = isProduction && status === 500
    ? "An internal server error occurred"
    : err.message;

  res.status(status).json({
    success: false,
    message,
    ...(isProduction ? {} : { stack: err.stack }),
  });
};

module.exports = errorHandler;
