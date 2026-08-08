const jwt = require("jsonwebtoken");
const axios = require("axios");

/**
 * Firebase Cloud Messaging, HTTP v1.
 *
 * v1 rather than the legacy `/fcm/send` endpoint: legacy server keys were
 * switched off by Google in 2024, and v1 is the only API that still accepts
 * new projects. iOS is reached through FCM's APNs bridge, so one credential
 * covers Android and iOS and there is no second certificate to renew.
 *
 * Auth is a self-signed service-account JWT exchanged for a short-lived OAuth2
 * access token. `google-auth-library` would do this too, but it is a large
 * dependency for one token exchange the `jsonwebtoken` already in this project
 * can perform in twenty lines.
 *
 * Configuration (all three required for push to be enabled):
 *   FCM_PROJECT_ID    the Firebase project id
 *   FCM_CLIENT_EMAIL  the service account's email
 *   FCM_PRIVATE_KEY   its PEM private key — see normalisePrivateKey below
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/**
 * `.env` files cannot hold real newlines, so the PEM is conventionally stored
 * with literal `\n` sequences. Both forms are accepted: a value pasted from a
 * secrets manager (real newlines) works unchanged, and so does the escaped
 * form. Surrounding quotes are stripped — a very common paste artefact that
 * otherwise fails deep inside the crypto layer with an unreadable error.
 */
const normalisePrivateKey = (raw) =>
  String(raw || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\n/g, "\n");

const config = () => ({
  projectId: (process.env.FCM_PROJECT_ID || "").trim(),
  clientEmail: (process.env.FCM_CLIENT_EMAIL || "").trim(),
  privateKey: normalisePrivateKey(process.env.FCM_PRIVATE_KEY),
});

/**
 * Read at call time, never frozen at module load — the same convention
 * services/sms.service.js follows, so a test or a redeploy can change the
 * credentials without a restart and a missing one is caught per send.
 */
const isConfigured = () => {
  const { projectId, clientEmail, privateKey } = config();
  return Boolean(projectId && clientEmail && privateKey);
};

const isEnabled = () => process.env.PUSH_ENABLED !== "false" && isConfigured();

// ─── Access token, cached ───────────────────────────────────────────────────

let cached = { token: null, expiresAt: 0, key: null };

/**
 * Google issues these for an hour. Refreshing at 55 minutes keeps a margin for
 * clock skew, and caching matters: without it every push would pay a second
 * network round trip.
 */
const getAccessToken = async () => {
  const { clientEmail, privateKey } = config();
  // Key the cache on the credential so rotating it mid-process is picked up
  // rather than served from a stale entry.
  const key = `${clientEmail}:${privateKey.slice(-24)}`;

  if (cached.token && cached.key === key && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    },
    privateKey,
    { algorithm: "RS256" }
  );

  const { data } = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10_000 }
  );

  cached = {
    token: data.access_token,
    key,
    expiresAt: Date.now() + Math.max(60, (data.expires_in || 3600) - 300) * 1000,
  };
  return cached.token;
};

/** Exposed so tests and a credential rotation can drop the cached token. */
const resetTokenCache = () => {
  cached = { token: null, expiresAt: 0, key: null };
};

// ─── Message construction ───────────────────────────────────────────────────

/**
 * FCM's `data` map is string→string; anything else is rejected outright with
 * INVALID_ARGUMENT. Objects are JSON-encoded so the client can parse them back,
 * and null/undefined entries are dropped rather than sent as "null".
 */
const stringifyData = (data = {}) => {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return out;
};

// FCM caps the whole message at 4 KB. Titles and bodies are trimmed well below
// that so a long body can never push the deep-link data out of the payload.
const MAX_TITLE = 200;
const MAX_BODY = 1000;
const truncate = (s, max) => {
  const str = String(s || "");
  return str.length <= max ? str : `${str.slice(0, max - 1)}…`;
};

/** Android notification-channel id. Must match the channel the app creates. */
const androidChannel = (priority) =>
  priority === "urgent" || priority === "high"
    ? process.env.PUSH_ANDROID_CHANNEL_HIGH || "soroman_important"
    : process.env.PUSH_ANDROID_CHANNEL_DEFAULT || "soroman_default";

/**
 * Build the v1 message envelope for one token.
 *
 * The per-platform blocks are not decoration. Without `android.priority=high`
 * a notification can be held for hours by Doze, and without
 * `apns-priority: 10` plus an `alert` payload iOS treats it as a silent
 * background push and may never display it.
 */
const buildMessage = ({ token, title, body, data = {}, priority = "normal", imageUrl, badge }) => {
  const high = priority === "urgent" || priority === "high";
  const safeTitle = truncate(title, MAX_TITLE);
  const safeBody = truncate(body, MAX_BODY);

  const message = {
    token,
    notification: {
      title: safeTitle,
      body: safeBody,
      ...(imageUrl ? { image: imageUrl } : {}),
    },
    data: stringifyData(data),
    android: {
      priority: high ? "HIGH" : "NORMAL",
      notification: {
        channel_id: androidChannel(priority),
        sound: "default",
        // Lets the app collapse a burst about one order into a single entry.
        ...(data.orderId ? { tag: `order-${data.orderId}` } : {}),
        ...(imageUrl ? { image: imageUrl } : {}),
      },
    },
    apns: {
      headers: {
        "apns-priority": high ? "10" : "5",
        "apns-push-type": "alert",
      },
      payload: {
        aps: {
          alert: { title: safeTitle, body: safeBody },
          sound: "default",
          ...(Number.isInteger(badge) ? { badge } : {}),
          // Lets the app rewrite the notification (localise, attach an image)
          // before it is shown.
          "mutable-content": 1,
        },
      },
    },
    webpush: {
      headers: { Urgency: high ? "high" : "normal" },
      notification: {
        title: safeTitle,
        body: safeBody,
        ...(imageUrl ? { image: imageUrl } : {}),
        icon: process.env.PUSH_WEB_ICON_URL || undefined,
      },
      ...(data.actionUrl ? { fcm_options: { link: data.actionUrl } } : {}),
    },
  };

  return message;
};

// ─── Send ───────────────────────────────────────────────────────────────────

/**
 * Google's verdicts on a token, and what each one means for the row that holds
 * it. UNREGISTERED and INVALID_ARGUMENT are permanent — the app was
 * uninstalled, or the token is malformed — and retrying either never succeeds,
 * so the caller retires the token instead of counting a failure.
 */
const PERMANENT_ERRORS = new Set(["UNREGISTERED", "INVALID_ARGUMENT", "SENDER_ID_MISMATCH"]);

const classifyError = (err) => {
  const status = err.response?.status;
  const details = err.response?.data?.error?.details || [];
  const fcmCode =
    details.find((d) => d["@type"]?.includes("FcmError"))?.errorCode ||
    err.response?.data?.error?.status ||
    "";

  if (PERMANENT_ERRORS.has(fcmCode)) {
    return { permanent: true, code: fcmCode, retryable: false };
  }
  // 404 on the send endpoint means "this token is not known to FCM".
  if (status === 404) return { permanent: true, code: "UNREGISTERED", retryable: false };
  // 401/403 is OUR credential, not the device's — never retire a token for it.
  if (status === 401 || status === 403) {
    return { permanent: false, code: fcmCode || "AUTH", retryable: true, credential: true };
  }
  // 429 and 5xx are transient by definition.
  if (status === 429 || (status >= 500 && status < 600)) {
    return { permanent: false, code: fcmCode || `HTTP_${status}`, retryable: true };
  }
  return { permanent: false, code: fcmCode || `HTTP_${status || "ERR"}`, retryable: true };
};

const errorMessage = (err) =>
  err.response?.data?.error?.message || err.message || "FCM send failed";

/**
 * Send to ONE device token.
 *
 * @returns {{success: boolean, messageId?: string, error?: string,
 *            code?: string, permanent?: boolean, retryable?: boolean}}
 *          Never throws — the caller is a fan-out loop, and one dead handset
 *          must not stop the other devices from being notified.
 */
const sendToToken = async (token, payload) => {
  if (!isEnabled()) {
    return { success: false, error: "Push is not configured", code: "DISABLED", permanent: false, retryable: false };
  }

  const { projectId } = config();

  try {
    const accessToken = await getAccessToken();
    const { data } = await axios.post(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      { message: buildMessage({ token, ...payload }) },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15_000,
      }
    );
    // data.name is "projects/<id>/messages/<message-id>".
    return { success: true, messageId: data?.name || "" };
  } catch (err) {
    const classified = classifyError(err);
    // A credential failure poisons the cached token — drop it so the next
    // attempt re-mints rather than replaying the same rejected bearer.
    if (classified.credential) resetTokenCache();
    return { success: false, error: errorMessage(err), ...classified };
  }
};

/**
 * Fan out to every token for one recipient.
 *
 * Sends are concurrent — a customer with four devices should not wait four
 * round trips — but each result is reported separately so the caller can
 * retire exactly the tokens FCM rejected.
 */
const sendToTokens = async (tokens, payload) => {
  const results = await Promise.all(
    tokens.map(async (token) => ({ token, ...(await sendToToken(token, payload)) }))
  );
  return {
    sent: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
};

module.exports = {
  isConfigured,
  isEnabled,
  getAccessToken,
  resetTokenCache,
  buildMessage,
  stringifyData,
  classifyError,
  sendToToken,
  sendToTokens,
};
