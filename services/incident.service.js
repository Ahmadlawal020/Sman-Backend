const { incidentRecordRepo } = require("../repositories");
const { emitEvent } = require("./events");

// Workflow: submitted -> reviewed -> resolved | rejected. Rejection is also
// allowed straight from submitted (obvious non-starters).
const TRANSITIONS = {
  submitted: ["reviewed", "rejected"],
  reviewed: ["resolved", "rejected"],
  resolved: [],
  rejected: [],
};

const submitIncident = async (data, { actor }) => {
  const record = await incidentRecordRepo.create({
    ...data,
    status: "submitted",
    submittedBy: actor?.id || null,
    submittedByName: actor?.name || "",
  });

  emitEvent("incident.submitted", {
    actor,
    entityType: "incident_record",
    entityId: record.id,
    incidentType: record.incidentType,
    title: record.title,
  });

  return { success: true, record };
};

const transitionIncident = async (id, { status, statusNote = "" }, { actor }) => {
  const record = await incidentRecordRepo.findById(id);
  if (!record) return { success: false, notFound: true, message: "Record not found" };

  if (!(TRANSITIONS[record.status] || []).includes(status)) {
    return {
      success: false,
      message: `Cannot move a ${record.status} record to ${status}`,
    };
  }

  const patch = {
    status,
    statusNote,
    reviewedBy: actor?.id || null,
    reviewedByName: actor?.name || "",
    reviewedAt: record.reviewedAt || new Date(),
  };
  if (status === "resolved") patch.resolvedAt = new Date();

  const updated = await incidentRecordRepo.update(id, patch);

  emitEvent(`incident.${status}`, {
    actor,
    entityType: "incident_record",
    entityId: id,
    incidentType: record.incidentType,
    statusNote,
  });

  return { success: true, record: updated };
};

module.exports = { submitIncident, transitionIncident };
