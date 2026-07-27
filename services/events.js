const { EventEmitter } = require("node:events");

// The platform event bus. Business services announce that something happened
// ("delivery.released", "ledger.entry_added"); they never know who listens.
// Audit and notifications are consumers, so controllers and services stay
// free of sendSMS()/email calls and new consumers (WhatsApp, push, analytics)
// plug in without touching business code.
//
// Delivery is in-process and at-most-once: a listener failure is logged and
// isolated, never propagated back into the emitting business operation.

const bus = new EventEmitter();
bus.setMaxListeners(50);

/**
 * Subscribe to a business event. The handler may be async; rejections are
 * caught and logged so one bad listener cannot break the others or the
 * business flow that emitted the event.
 */
const onEvent = (name, handler) => {
  bus.on(name, (payload) => {
    Promise.resolve()
      .then(() => handler(payload))
      .catch((err) => {
        console.error(`[events] listener for "${name}" failed:`, err.message);
      });
  });
};

/**
 * Announce a business event. Fire-and-forget by design: the emitting
 * transaction has already committed, and side effects must not undo it.
 */
const emitEvent = (name, payload = {}) => {
  bus.emit(name, { ...payload, event: name, occurredAt: new Date() });
  // The wildcard channel lets cross-cutting consumers (audit) see everything
  // without enumerating event names.
  bus.emit("*", { ...payload, event: name, occurredAt: new Date() });
};

module.exports = { emitEvent, onEvent };
