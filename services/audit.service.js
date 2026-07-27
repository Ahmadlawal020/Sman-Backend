const auditEventRepo = require("../repositories/auditEvent.repository");
const { onEvent } = require("./events");

// Every business event becomes an audit row. Services attach the actor and
// entity in the event payload; anything else in the payload is preserved in
// metadata for investigation.
const AUDIT_PAYLOAD_KEYS = ["event", "occurredAt", "actor", "entityType", "entityId"];

const record = async ({ action, actor = {}, entityType = "", entityId = "", metadata = null }) => {
  return auditEventRepo.create({
    action,
    actorType: actor.type || "system",
    actorId: actor.id || null,
    actorName: actor.name || "",
    entityType,
    entityId: entityId === null || entityId === undefined ? "" : String(entityId),
    metadata,
  });
};

const registerAuditListener = () => {
  onEvent("*", async (payload) => {
    const metadata = {};
    for (const [key, value] of Object.entries(payload)) {
      if (!AUDIT_PAYLOAD_KEYS.includes(key)) metadata[key] = value;
    }
    await record({
      action: payload.event,
      actor: payload.actor || {},
      entityType: payload.entityType || "",
      entityId: payload.entityId ?? "",
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
    });
  });
};

module.exports = { record, registerAuditListener };
