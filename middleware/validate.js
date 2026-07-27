/**
 * Request validation against Zod schemas.
 *
 *   router.post("/", validate({ body: createOrderSchema }), createOrder);
 *   router.get("/", validate({ query: listOrdersSchema }), getOrders);
 *   router.get("/:id", validate({ params: idParam }), getOrderById);
 *
 * Schemas strip unknown keys (Zod's default), so a schema doubles as a
 * whitelist — a POST carrying `{name, balance: 99999}` reaches the controller
 * as `{name}`. That is what closes mass assignment on a validated route.
 */

/**
 * `safeParse`, not `parse`. A validation failure is an expected outcome of an
 * HTTP API, not an exception: routing it through try/catch means it can only
 * be distinguished from a genuine fault by instanceof, and anything that
 * wraps the error — as Drizzle does with driver errors — breaks that check.
 */
function parseOrRespond(schema, value, source, res) {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };

  res.status(400).json({
    success: false,
    message: "Validation failed",
    // `issues`, not `errors` — Zod 4 has no `error.errors`. `path` is always
    // an array, empty for a root-level failure.
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join(".") || source,
      message: issue.message,
    })),
  });
  return { ok: false };
}

const validate = (schemas) => (req, res, next) => {
  if (schemas.body) {
    const r = parseOrRespond(schemas.body, req.body, "body", res);
    if (!r.ok) return;
    // Writable, so the parsed value replaces it wholesale and every controller
    // downstream gets coerced types and stripped keys with no change.
    req.body = r.data;
  }

  if (schemas.params) {
    const r = parseOrRespond(schemas.params, req.params, "params", res);
    if (!r.ok) return;
    req.params = r.data;
  }

  if (schemas.query) {
    const r = parseOrRespond(schemas.query, req.query, "query", res);
    if (!r.ok) return;

    // Express 5 exposes req.query as a getter. Assigning to it does NOT throw
    // — it silently does nothing, which is worse, because the code reads as
    // though it worked. The object it returns is a plain object, so it has to
    // be edited in place: drop keys the schema rejected, then apply the
    // coerced values. Object.assign alone would leave unknown keys behind and
    // quietly defeat the whitelist.
    for (const key of Object.keys(req.query)) {
      if (!(key in r.data)) delete req.query[key];
    }
    Object.assign(req.query, r.data);

    // Also exposed explicitly, so new code need not rely on the mutation.
    req.validated = { ...(req.validated || {}), query: r.data };
  }

  next();
};

module.exports = validate;
