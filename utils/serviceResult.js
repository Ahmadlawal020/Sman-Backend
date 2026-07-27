// Uniform mapping from service results to HTTP. Services return plain
// objects with outcome flags; controllers stay one line per endpoint.
const sendServiceResult = (res, result, { successStatus = 200, message } = {}) => {
  if (result.success) {
    const { success, ...data } = result;
    return res.status(successStatus).json({ success: true, message, data });
  }
  let status = 400;
  if (result.notFound) status = 404;
  else if (result.forbidden) status = 403;
  else if (result.duplicate || result.alreadyHeld) status = 409;
  return res.status(status).json({ success: false, message: result.message });
};

module.exports = { sendServiceResult };
