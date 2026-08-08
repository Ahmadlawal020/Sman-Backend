const fcm = require("../fcm");
const deviceTokenRepo = require("../../repositories/deviceToken.repository");
const notificationRepo = require("../../repositories/notification.repository");

/**
 * Mobile and web push, over FCM.
 *
 * Returns ONE result per device, not one per recipient: a customer with a
 * phone and a tablet has two independent deliveries, either of which can fail
 * on its own, and collapsing them would hide a handset that has stopped
 * receiving anything.
 */

/** Log the tail only — a whole FCM token is a live credential for that device. */
const maskToken = (token) => `…${String(token || "").slice(-12)}`;

/**
 * The iOS badge number.
 *
 * iOS does not increment badges by itself: whatever integer the payload
 * carries is what the icon shows, so sending nothing leaves a stale count and
 * sending `1` permanently pins it at one. The recipient's true unread count is
 * the only correct value, and a failure to compute it is not worth failing the
 * push over — omitting the key leaves the badge untouched.
 */
const resolveBadge = async (principal) => {
  try {
    return await notificationRepo.unreadCount(principal);
  } catch {
    return undefined;
  }
};

/**
 * @returns {Promise<Array<{destination, status, providerMessageId, error}>>}
 */
const send = async ({ principal, rendered }) => {
  if (!fcm.isEnabled()) {
    return [
      {
        destination: "",
        status: "skipped",
        error: fcm.isConfigured() ? "Push disabled (PUSH_ENABLED=false)" : "FCM is not configured",
      },
    ];
  }

  const tokens = await deviceTokenRepo.findLiveForPrincipal(principal);
  if (!tokens.length) {
    return [{ destination: "", status: "skipped", error: "No registered devices" }];
  }

  const badge = await resolveBadge(principal);
  const push = rendered.push || {};

  const { results } = await fcm.sendToTokens(
    tokens.map((t) => t.token),
    {
      title: push.title || rendered.title,
      body: push.body || rendered.body,
      // The deep link travels in `data`, so tapping the notification lands on
      // the right screen rather than the app's home.
      data: {
        ...rendered.data,
        type: rendered.type,
        category: rendered.category,
        ...(rendered.notificationId ? { notificationId: rendered.notificationId } : {}),
        ...(rendered.actionUrl ? { actionUrl: rendered.actionUrl } : {}),
      },
      priority: rendered.priority,
      imageUrl: push.imageUrl || rendered.imageUrl || undefined,
      badge,
    }
  );

  // Feed each verdict back to the token that earned it. Permanent verdicts
  // retire the row immediately; transient ones only count against it, so a bad
  // afternoon at Google does not unregister the fleet.
  await Promise.all(
    results.map(async (r) => {
      if (r.success) return deviceTokenRepo.recordSuccess(r.token);
      if (r.permanent) return deviceTokenRepo.disableToken(r.token, r.code === "UNREGISTERED" ? "unregistered" : "invalid");
      if (r.retryable) return deviceTokenRepo.recordFailure(r.token);
      return null;
    })
  );

  return results.map((r) => ({
    destination: maskToken(r.token),
    status: r.success ? "sent" : "failed",
    providerMessageId: r.messageId || "",
    error: r.success ? null : `${r.code || "ERR"}: ${r.error}`,
  }));
};

module.exports = { send, maskToken };
