const { principalKey } = require("../utils/principal");

/**
 * Server-Sent Events hub — live notifications into open dashboards and web
 * apps, without the client polling.
 *
 * SSE rather than WebSockets: the traffic is strictly one-way (server tells
 * client something happened), it rides plain HTTP/1.1 through every proxy in
 * the path, and `EventSource` reconnects on its own. A WebSocket would add a
 * dependency and a handshake to buy a direction nothing sends in.
 *
 * SCOPE — this hub is IN-PROCESS. A browser connected to instance A hears
 * nothing about a notification written by instance B. That is correct for this
 * deployment (one Node process, with the WhatsApp and scheduler workers riding
 * along inside it — see server.js), and it is why the REST API exposes
 * `unread-count`: clients treat the stream as an optimisation and fall back to
 * polling. Running more than one instance means either sticky sessions or
 * moving this fan-out to a shared broker; see docs/NOTIFICATIONS.md.
 */

// principalKey → Set of { res, id }
const subscribers = new Map();

let nextId = 1;
let heartbeat = null;

const HEARTBEAT_MS = Number(process.env.NOTIFY_SSE_HEARTBEAT_MS || 25_000);
// Proxies and load balancers commonly cut an idle connection at 30–60 s. A
// comment line every 25 s is invisible to EventSource and keeps the socket
// warm; without it clients reconnect in a loop and every reconnect costs a
// replay query.
const startHeartbeat = () => {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    for (const set of subscribers.values()) {
      for (const sub of set) {
        try {
          sub.res.write(": ping\n\n");
        } catch {
          // A write to a dead socket is not an error worth logging — the
          // 'close' handler will remove it a moment from now.
        }
      }
    }
  }, HEARTBEAT_MS);
  // Never hold the process open for a heartbeat.
  heartbeat.unref?.();
};

const stopHeartbeat = () => {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
};

const MAX_PER_PRINCIPAL = Number(process.env.NOTIFY_SSE_MAX_PER_PRINCIPAL || 5);

/**
 * Attach a response as a live subscriber. Returns an unsubscribe function; the
 * caller wires it to the request's 'close' event.
 */
const subscribe = (principal, res) => {
  const key = principalKey(principal);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // nginx buffers proxied responses by default, which holds events until the
    // buffer fills — for an event stream that means "never".
    "X-Accel-Buffering": "no",
  });
  // Flush the headers immediately so EventSource fires `onopen` now rather
  // than when the first event happens to arrive.
  res.flushHeaders?.();

  // Tell the client how long to wait before reconnecting after a drop.
  res.write(`retry: ${Number(process.env.NOTIFY_SSE_RETRY_MS || 5000)}\n\n`);
  res.write(`event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

  const sub = { res, id: nextId++ };
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  const set = subscribers.get(key);

  // One tab per device is normal; a hundred is a leaking client. Dropping the
  // oldest bounds the damage — a browser that reconnects gets a live stream,
  // and a runaway one cannot pin unbounded memory.
  if (set.size >= MAX_PER_PRINCIPAL) {
    const oldest = set.values().next().value;
    if (oldest) {
      set.delete(oldest);
      try {
        oldest.res.end();
      } catch {
        /* already gone */
      }
    }
  }

  set.add(sub);
  startHeartbeat();

  return () => {
    const current = subscribers.get(key);
    if (!current) return;
    current.delete(sub);
    if (current.size === 0) subscribers.delete(key);
    if (subscribers.size === 0) stopHeartbeat();
  };
};

/** Write one SSE frame. Returns false if the socket has gone. */
const write = (res, event, payload) => {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
};

/**
 * Push an event to every live connection for one principal. Silent when nobody
 * is connected, which is the normal case — SSE is an optimisation over the
 * REST endpoints, never the system of record.
 */
const publish = (principal, event, payload) => {
  const set = subscribers.get(principalKey(principal));
  if (!set || set.size === 0) return 0;

  let delivered = 0;
  for (const sub of [...set]) {
    if (write(sub.res, event, payload)) delivered += 1;
    else set.delete(sub);
  }
  if (set.size === 0) subscribers.delete(principalKey(principal));
  return delivered;
};

/** A new inbox row, plus the recomputed badge so the client needn't re-fetch. */
const publishNotification = (principal, notification, unreadCount) =>
  publish(principal, "notification", { notification, unreadCount });

/** Read state changed elsewhere (another tab, the mobile app). */
const publishRead = (principal, { ids = [], unreadCount }) =>
  publish(principal, "read", { ids, unreadCount });

const publishUnreadCount = (principal, unreadCount) =>
  publish(principal, "unread-count", { unreadCount });

/** Connection stats, for the admin health endpoint. */
const stats = () => ({
  principals: subscribers.size,
  connections: [...subscribers.values()].reduce((sum, set) => sum + set.size, 0),
  heartbeatMs: HEARTBEAT_MS,
});

/** Close every stream — used on shutdown and between test files. */
const closeAll = () => {
  for (const set of subscribers.values()) {
    for (const sub of set) {
      try {
        sub.res.end();
      } catch {
        /* already gone */
      }
    }
  }
  subscribers.clear();
  stopHeartbeat();
};

module.exports = {
  subscribe,
  publish,
  publishNotification,
  publishRead,
  publishUnreadCount,
  stats,
  closeAll,
};
