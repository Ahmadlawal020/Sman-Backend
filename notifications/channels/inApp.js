const notificationRepo = require("../../repositories/notification.repository");
const sse = require("../sse");

/**
 * The in-app inbox channel.
 *
 * Unlike the outbound channels this one does not call a provider — the write
 * to `notifications` IS the delivery. The SSE publish afterwards is best
 * effort: a dashboard that happens to be open finds out now, and one that
 * isn't finds out on its next poll. A failed publish is therefore never a
 * failed delivery.
 */

/**
 * @returns {Promise<{notification: object|null, duplicate: boolean}>}
 *          `duplicate` means the dedupe key already existed — the recipient
 *          has been told, and the caller must not send this again on any
 *          channel.
 */
const create = async ({ principal, rendered, entry, type }) => {
  const row = await notificationRepo.create({
    principal,
    type,
    category: entry.category,
    priority: rendered.priority,
    title: rendered.title,
    body: rendered.body,
    data: rendered.data,
    entityType: rendered.entity.type,
    entityId: rendered.entity.id,
    actionUrl: rendered.actionUrl,
    imageUrl: rendered.imageUrl,
    dedupeKey: rendered.dedupeKey,
  });

  if (!row) return { notification: null, duplicate: true };
  return { notification: row, duplicate: false };
};

/**
 * Push the new row down any open stream, with a freshly counted badge so the
 * client does not have to ask for it.
 */
const publish = async (principal, notification) => {
  try {
    const unread = await notificationRepo.unreadCount(principal);
    sse.publishNotification(principal, notification, unread);
  } catch (err) {
    console.error("[notify] SSE publish failed:", err.message);
  }
};

module.exports = { create, publish };
