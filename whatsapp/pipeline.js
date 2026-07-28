const { reduce } = require("./engine");
const { normalizeInbound } = require("./normalize");
const { loadContext } = require("./context");
const { EFFECTS, INBOUND } = require("./constants");
const { customerRepo, waMessageRepo, waSessionRepo } = require("../repositories");
const { placeOrder } = require("../services/order.service");
const { sendReply } = require("./client");
const { QUEUES, enqueue } = require("../config/queue");

/**
 * One conversation turn, end to end: load → reduce → perform effects →
 * re-enter → persist → queue replies. The engine stays pure; every side
 * effect lives here, and every step is idempotent so a pg-boss retry of a
 * half-finished turn cannot double-order (placeOrder gets the wamid as its
 * idempotency key) or double-create a customer (find-or-create by phone).
 */

// An effect's outcome re-enters the engine as a new inbound. Bounded: no
// engine path emits chains longer than this, so more means a logic bug.
const MAX_TURNS = 4;

/** Perform one engine effect; return the inbound that re-enters the loop. */
const performEffect = async (effect, { wamid, waPhone }) => {
  switch (effect.type) {
    case EFFECTS.CREATE_CUSTOMER: {
      // Find-or-create: a pg-boss retry (or a very fast double text) may have
      // created the customer already — the phone's unique index decides.
      let customer = await customerRepo.findByPhone(waPhone);
      if (!customer) {
        try {
          customer = await customerRepo.create({
            name: effect.payload.name,
            phone: waPhone,
            status: "Active",
            createdVia: "whatsapp",
            // The WhatsApp message itself proves phone control — Meta
            // verified the number. No OTP, by decision.
            phoneVerifiedAt: new Date(),
          });
        } catch (err) {
          customer = await customerRepo.findByPhone(waPhone); // lost a race — fine
          if (!customer) throw err;
        }
      }
      return { type: INBOUND.CUSTOMER_CREATED, customer };
    }

    case EFFECTS.CREATE_ORDER: {
      try {
        const result = await placeOrder({
          ...effect.payload,
          actor: { type: "customer", customerId: effect.payload.customerId },
          idempotencyKey: wamid,
        });
        return { type: INBOUND.ORDER_CREATED, order: result.order };
      } catch (err) {
        console.error("[wa-pipeline] CREATE_ORDER failed:", err.message);
        if (/stock/i.test(err.message || "")) {
          // Let the engine re-ask with the truthful figure; a fresh context
          // is loaded on re-entry, so stock: 0 simply means "re-pick".
          return { type: INBOUND.ORDER_FAILED, reason: "stock", stock: 0 };
        }
        return { type: INBOUND.ORDER_FAILED, reason: "generic" };
      }
    }

    default:
      console.error(`[wa-pipeline] unknown effect "${effect.type}" ignored`);
      return null;
  }
};

/**
 * Process one recorded inbound message. Job handler for the wa-inbound
 * queue; also the janitor's re-entry point, so it must tolerate re-runs.
 */
const processInbound = async ({ waMessageId }) => {
  const message = await waMessageRepo.findById(waMessageId);
  if (!message || message.direction !== "inbound") return;
  if (message.status === "processed") return; // a retry of a finished turn

  const waPhone = message.waPhone;
  const stored = await waSessionRepo.findByPhone(waPhone);
  let customer = await customerRepo.findByPhone(waPhone);

  let session = {
    waPhone,
    customerId: customer?.id ?? stored?.customerId,
    state: stored?.state,
    cart: stored?.cart || {},
    lastOrderId: stored?.lastOrderId,
    failureCount: stored?.failureCount || 0,
    expired: waSessionRepo.isExpired(stored),
  };

  let inbound = normalizeInbound(message.payload);
  const replies = [];

  for (let turn = 0; turn < MAX_TURNS && inbound; turn += 1) {
    const context = await loadContext({ waPhone, customer, session });
    const result = reduce(session, inbound, context);
    session = result.session;
    replies.push(...result.replies);

    inbound = null;
    for (const effect of result.effects) {
      inbound = await performEffect(effect, { wamid: message.wamid, waPhone });
      if (inbound?.type === INBOUND.CUSTOMER_CREATED) {
        customer = inbound.customer; // the next context load must know them
      }
    }
  }

  const saved = await waSessionRepo.save(waPhone, session);

  // Record first, send later: each reply is a queued wa_messages row before
  // any network attempt, so the kill switch or a Cloud API outage leaves a
  // visible trail instead of silence.
  for (const reply of replies) {
    const outbound = await waMessageRepo.createOutbound({
      waPhone,
      sessionId: saved.id,
      customerId: customer?.id ?? null,
      payload: reply,
    });
    await enqueue(QUEUES.WA_SEND, { waMessageId: outbound.id });
  }

  await waMessageRepo.markProcessed(message.id, {
    sessionId: saved.id,
    customerId: customer?.id ?? null,
  });
};

/**
 * Send one queued outbound row. Job handler for the wa-send queue. Failed
 * rows stay retryable — pg-boss backs off and eventually dead-letters, and
 * every outcome lands on the row.
 */
const processSend = async ({ waMessageId }) => {
  const row = await waMessageRepo.findById(waMessageId);
  if (!row || row.direction !== "outbound") return;
  if (!["queued", "failed"].includes(row.status)) return; // sent already — a stale retry

  try {
    const result = await sendReply(row.waPhone, row.payload);
    if (result.skipped) {
      await waMessageRepo.markSkipped(row.id, result.reason);
      return;
    }
    await waMessageRepo.markSent(row.id, result.wamid);
  } catch (err) {
    await waMessageRepo.markFailed(row.id, err.message);
    throw err; // pg-boss owns the retry/backoff/dead-letter from here
  }
};

module.exports = { processInbound, processSend, performEffect, MAX_TURNS };
