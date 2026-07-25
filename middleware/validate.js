const { ZodError } = require("zod");

/**
 * Express middleware factory that validates req.body (and optionally req.query / req.params)
 * against supplied Zod schemas.
 *
 * Usage:
 *   router.post("/login", validate({ body: loginSchema }), controller);
 *   router.get("/orders", validate({ query: orderQuerySchema }), controller);
 */
const validate =
  (schemas) =>
  (req, res, next) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        // Express 5 exposes req.query as a read-only getter, so it cannot be
        // reassigned. Mutate the existing object in place instead.
        Object.assign(req.query, schemas.query.parse(req.query));
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const messages = err.issues.map((e) => {
          const path = e.path.length > 0 ? `${e.path.join(".")}: ` : "";
          return `${path}${e.message}`;
        });
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: messages,
        });
      }
      next(err);
    }
  };

module.exports = validate;
