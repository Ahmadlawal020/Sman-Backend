const z = require("zod");

/**
 * Shared field types.
 *
 * Coercion here is deliberately narrower than `z.coerce`. Zod's built-in
 * coercion applies JavaScript's `Number()` semantics, which accepts far more
 * than anyone intends:
 *
 *   z.coerce.number().parse("")     ->  0
 *   z.coerce.number().parse(null)   ->  0
 *   z.coerce.number().parse(true)   ->  1
 *   z.coerce.number().parse([])     ->  0
 *   z.coerce.number().parse([5])    ->  5
 *   z.coerce.number().parse("0x10") ->  16
 *
 * So `{"quantity": []}` becomes an order for zero litres, and `{"balance":
 * true}` becomes one naira. Every one of those is silently accepted.
 *
 * `numberLike` instead accepts only a real finite number, or a string that
 * actually looks like one. Clients still get the convenience of sending "500"
 * from a form field; they do not get null, booleans or arrays turning into
 * numbers behind their back.
 */
const numberLike = z.union([
  z.number().finite(),
  z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d+)?$/, "must be a number")
    .transform(Number),
]);

/** A database id: positive integer. Rejects "abc" before it reaches Postgres. */
const id = numberLike.pipe(z.number().int().positive());

/** Litres, units — a whole positive count. */
const quantity = numberLike.pipe(z.number().int().positive());

/**
 * Money for a Postgres `numeric(15,2)` column.
 *
 * Kept in string space end to end rather than round-tripped through a float:
 * the driver takes a string, and passing a JS number risks precision loss on
 * the way in. `multipleOf(0.01)` is not used — it is unreliable at floating
 * point boundaries, which is exactly where money errors hide.
 *
 * numeric(15,2) is 15 digits of precision with 2 after the point, so at most
 * 13 before it. Anything larger is rejected here rather than by the database.
 *
 * Accepts 0, 1 or 2 decimal places and normalises to exactly 2.
 */
const MAX_INTEGER_DIGITS = 13;

const money = ({ min = 0 } = {}) =>
  z
    .union([z.number().finite(), z.string().trim()])
    .transform((v) => (typeof v === "number" ? v.toFixed(2) : v))
    .pipe(
      z
        .string()
        .regex(/^\d+(\.\d{1,2})?$/, "must be a non-negative amount with at most 2 decimal places")
        .refine(
          (s) => s.split(".")[0].replace(/^0+(?=\d)/, "").length <= MAX_INTEGER_DIGITS,
          `must not exceed ${MAX_INTEGER_DIGITS} digits before the decimal point`
        )
        .refine((s) => Number(s) >= min, `must be at least ${min}`)
        // Normalise so the driver always receives the same shape.
        .transform((s) => Number(s).toFixed(2))
    );

/** Free text that must actually contain something. */
const nonEmptyString = (max = 255) => z.string().trim().min(1).max(max);

/** Optional free text — absent, or non-empty once trimmed. */
const optionalString = (max = 255) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v ?? "");

/** Pagination shared by every list endpoint. */
const pagination = z.object({
  page: numberLike.pipe(z.number().int().positive()).optional().default(1),
  limit: numberLike.pipe(z.number().int().positive().max(100)).optional().default(50),
});

module.exports = {
  numberLike,
  id,
  quantity,
  money,
  nonEmptyString,
  optionalString,
  pagination,
  MAX_INTEGER_DIGITS,
};
