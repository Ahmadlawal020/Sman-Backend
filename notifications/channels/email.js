const { Resend } = require("resend");

/**
 * Transactional email, over Resend — the provider services/email.service.js
 * already uses, so there is one sender reputation and one dashboard.
 *
 * The client is built lazily and re-built when the key changes, matching the
 * call-time-config convention in services/sms.service.js: a test or a redeploy
 * can swap the key without a restart, and a missing key is caught per send
 * rather than throwing at require() time and taking the whole app down.
 */

let client = null;
let clientKey = null;

const apiKey = () => (process.env.RESEND_API_KEY || "").trim();

const getClient = () => {
  const key = apiKey();
  if (!client || clientKey !== key) {
    client = new Resend(key);
    clientKey = key;
  }
  return client;
};

const isEnabled = () => process.env.EMAIL_ENABLED !== "false" && Boolean(apiKey());

const from = () =>
  process.env.EMAIL_FROM || "Soroman Dashboard <onboarding@resend.dev>";

/**
 * A very loose check — real validation is the provider's job, and rejecting an
 * address Resend would have accepted is worse than letting it try. This only
 * catches the empty and obviously-not-an-address cases so they are recorded as
 * `skipped` (nothing to send to) rather than `failed` (the provider refused).
 */
const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

/**
 * @returns {Promise<Array<{destination, status, providerMessageId, error}>>}
 */
const send = async ({ contact, rendered }) => {
  const to = String(contact?.email || "").trim();

  if (!looksLikeEmail(to)) {
    return [{ destination: to, status: "skipped", error: "No email address on file" }];
  }
  if (!isEnabled()) {
    return [
      {
        destination: to,
        status: "skipped",
        error: apiKey() ? "Email disabled (EMAIL_ENABLED=false)" : "RESEND_API_KEY is not configured",
      },
    ];
  }

  const email = rendered.email;
  if (!email?.html) {
    return [{ destination: to, status: "skipped", error: "No email template for this type" }];
  }

  try {
    const { data, error } = await getClient().emails.send({
      from: from(),
      to,
      subject: email.subject || rendered.title,
      html: email.html,
      ...(email.text ? { text: email.text } : {}),
      ...(email.replyTo ? { replyTo: email.replyTo } : {}),
    });

    // Resend reports failures in the response body, not by throwing — a send
    // that returns `{ error }` and is treated as success is a message nobody
    // ever receives and nobody ever notices.
    if (error) {
      return [
        { destination: to, status: "failed", providerMessageId: "", error: error.message || String(error) },
      ];
    }

    return [{ destination: to, status: "sent", providerMessageId: data?.id || "", error: null }];
  } catch (err) {
    return [{ destination: to, status: "failed", providerMessageId: "", error: err.message }];
  }
};

module.exports = { send, isEnabled, looksLikeEmail };
