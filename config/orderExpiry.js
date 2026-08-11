/**
 * How long an unpaid depot order (or approved Dangote/LPG request) may sit
 * before the expiry sweep lapses it. One knob for sweep, computed `expiresAt`,
 * and the public catalog's `orderExpiryHours` — read lazily so env overrides
 * and tests apply without restarting the process.
 */
const orderExpiryHours = () => {
  const n = Number(process.env.ORDER_EXPIRY_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 24;
};

const orderExpiryMs = () => orderExpiryHours() * 60 * 60 * 1000;

module.exports = { orderExpiryHours, orderExpiryMs };
