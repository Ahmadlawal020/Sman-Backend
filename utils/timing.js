const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Hold a response until at least `floorMs` has elapsed since `startedAt`.
 *
 * Enumeration safety is not only about returning the same body. "Send an OTP
 * to a known number" and "do nothing for an unknown one" differ by an SMS
 * round trip, so an attacker can distinguish them on the clock alone. The
 * floor has to exceed the slowest branch to actually flatten that.
 *
 * @param {number} startedAt  Date.now() captured at the top of the handler
 * @param {number} floorMs
 */
async function constantTimeFloor(startedAt, floorMs) {
  const elapsed = Date.now() - startedAt;
  if (elapsed < floorMs) await sleep(floorMs - elapsed);
}

module.exports = { sleep, constantTimeFloor };
