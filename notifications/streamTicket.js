const crypto = require("node:crypto");
const { principalKey } = require("../utils/principal");

/**
 * Single-use tickets for the SSE stream.
 *
 * The browser's `EventSource` cannot send an Authorization header, so a
 * cookie or a URL parameter is the only way to authenticate the stream. Both
 * obvious options are bad: the access token in a query string ends up in nginx
 * logs, browser history and any Referer sent from the page, and it is valid
 * for fifteen minutes against every endpoint in the API.
 *
 * A ticket is instead minted by an ordinary Bearer-authenticated POST, then
 * spent on the stream. It is opaque, single-use, expires in seconds, and grants
 * exactly one capability — "open a notification stream as this principal". A
 * ticket leaked through a log is worth nothing by the time anyone reads it.
 *
 * Native clients skip all of this: a React Native EventSource implementation
 * can set headers, so the stream endpoint accepts a normal Bearer token too.
 *
 * In-memory, like the SSE hub it authenticates — a ticket is only useful on
 * the instance holding the connection it will open.
 */

const TTL_MS = Number(process.env.NOTIFY_STREAM_TICKET_TTL_MS || 30_000);

// ticket → { principal, expiresAt }
const tickets = new Map();

let sweeper = null;

/**
 * Expired tickets are dropped on read, so this only exists to stop tickets
 * that are minted and never spent from accumulating.
 */
const startSweeper = () => {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [ticket, entry] of tickets) {
      if (entry.expiresAt <= now) tickets.delete(ticket);
    }
    if (tickets.size === 0) {
      clearInterval(sweeper);
      sweeper = null;
    }
  }, Math.max(5_000, TTL_MS));
  sweeper.unref?.();
};

/** Mint a ticket for an already-authenticated principal. */
const issue = (principal) => {
  const ticket = crypto.randomBytes(32).toString("base64url");
  tickets.set(ticket, { principal, expiresAt: Date.now() + TTL_MS });
  startSweeper();
  return { ticket, expiresIn: Math.floor(TTL_MS / 1000) };
};

/**
 * Spend a ticket. Deleted on the first read whether or not it had expired, so
 * a captured ticket cannot be replayed even within its window.
 */
const redeem = (ticket) => {
  if (!ticket) return null;
  const entry = tickets.get(ticket);
  if (!entry) return null;
  tickets.delete(ticket);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.principal;
};

/** Revoke every outstanding ticket for a principal — used on sign-out. */
const revokeFor = (principal) => {
  const key = principalKey(principal);
  let revoked = 0;
  for (const [ticket, entry] of tickets) {
    if (principalKey(entry.principal) === key) {
      tickets.delete(ticket);
      revoked += 1;
    }
  }
  return revoked;
};

const clear = () => {
  tickets.clear();
  if (sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
};

module.exports = { issue, redeem, revokeFor, clear, TTL_MS };
